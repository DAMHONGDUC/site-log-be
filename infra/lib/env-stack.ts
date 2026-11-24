import { Aws, CfnOutput, Duration, RemovalPolicy, Stack, type StackProps, Tags } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import type { Construct } from 'constructs';

export interface EnvSettings {
  apiDomain: string;
  instanceType: string;
  alarmEmail: string;
}

interface EnvStackProps extends StackProps {
  envName: 'staging' | 'prod';
  settings: EnvSettings;
}

// One environment: network, database, bucket, one EC2 server running Docker Compose, alarms.
export class EnvStack extends Stack {
  constructor(scope: Construct, id: string, props: EnvStackProps) {
    super(scope, id, props);
    const { envName, settings } = props;
    const isProd = envName === 'prod';

    // Public subnets for the server, isolated subnets (no internet at all) for the database.
    // No NAT gateway: it would cost more than the server.
    const vpc = new ec2.Vpc(this, 'Vpc', {
      // Two zones named up front, so `cdk synth` needs no AWS login (RDS needs two zones).
      availabilityZones: [`${this.region}a`, `${this.region}b`],
      natGateways: 0,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'database', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    const bucket = new s3.Bucket(this, 'Media', {
      bucketName: `sitelog-${envName}-${Aws.ACCOUNT_ID}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // Parts of uploads nobody completed are removed after a week.
      lifecycleRules: [{ abortIncompleteMultipartUploadAfter: Duration.days(7) }],
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const serverSecurityGroup = new ec2.SecurityGroup(this, 'ServerSg', {
      vpc,
      description: 'SiteLog API server: HTTP and HTTPS from anywhere, nothing else',
    });

    serverSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'HTTP for the certificate check',
    );
    serverSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS');

    const databaseSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSg', {
      vpc,
      description: 'SiteLog Postgres: only from the API server',
    });

    databaseSecurityGroup.addIngressRule(
      serverSecurityGroup,
      ec2.Port.tcp(5432),
      'Postgres from the server',
    );

    // Username sitelog, a generated password kept in Secrets Manager.
    const database = new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [databaseSecurityGroup],
      credentials: rds.Credentials.fromGeneratedSecret('sitelog'),
      databaseName: 'sitelog',
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      multiAz: false,
      publiclyAccessible: false,
      backupRetention: Duration.days(isProd ? 14 : 7),
      deletionProtection: isProd,
      removalPolicy: isProd ? RemovalPolicy.SNAPSHOT : RemovalPolicy.DESTROY,
    });

    const logGroups: logs.LogGroup[] = [];

    for (const service of ['api', 'worker', 'caddy']) {
      logGroups.push(
        new logs.LogGroup(this, `Logs-${service}`, {
          logGroupName: `/sitelog/${envName}/${service}`,
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
      );
    }

    // Created by SiteLog-Shared; found by name so the stacks stay independent.
    const repository = ecr.Repository.fromRepositoryName(this, 'Api', 'sitelog-api');

    // What the server may do: pull the image, read its secrets, use its bucket, write logs.
    const role = new iam.Role(this, 'ServerRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        // Session Manager: shell access and deploy commands without SSH or open port 22.
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    repository.grantPull(role);
    bucket.grantReadWrite(role);
    database.secret!.grantRead(role);
    for (const group of logGroups) {
      group.grantWrite(role);
    }
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParametersByPath'],
        resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/sitelog/${envName}`],
      }),
    );

    // Settings that are not secret, written once on the server; the deploy script reads them.
    const instanceEnv = [
      `ENV_NAME=${envName}`,
      `AWS_REGION=${this.region}`,
      `S3_BUCKET=${bucket.bucketName}`,
      `API_DOMAIN=${settings.apiDomain}`,
      `ECR_REPOSITORY=${repository.repositoryUri}`,
      `DB_SECRET_ARN=${database.secret!.secretArn}`,
    ].join('\n');

    const userData = ec2.UserData.forLinux();

    userData.addCommands(
      'set -euo pipefail',
      'dnf install -y docker jq',
      'systemctl enable --now docker',
      // Docker Compose v2 as a docker plugin (Amazon Linux has no package for it).
      'mkdir -p /usr/local/lib/docker/cli-plugins',
      'curl -fsSL https://github.com/docker/compose/releases/download/v2.29.7/docker-compose-linux-aarch64 -o /usr/local/lib/docker/cli-plugins/docker-compose',
      'chmod +x /usr/local/lib/docker/cli-plugins/docker-compose',
      'mkdir -p /opt/sitelog',
      `cat > /opt/sitelog/instance.env <<'ENVEOF'\n${instanceEnv}\nENVEOF`,
      // sitelog-deploy <tag>: pull the image, copy deploy/ out of it, run its deploy.sh.
      `cat > /usr/local/bin/sitelog-deploy <<'SCRIPTEOF'
#!/usr/bin/env bash
set -euo pipefail
TAG="$1"
source /opt/sitelog/instance.env
REGISTRY="\${ECR_REPOSITORY%%/*}"
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$REGISTRY"
docker pull "$ECR_REPOSITORY:$TAG"
CONTAINER=$(docker create "$ECR_REPOSITORY:$TAG")
docker cp "$CONTAINER:/app/deploy/." /opt/sitelog/
docker rm "$CONTAINER" > /dev/null
exec bash /opt/sitelog/deploy.sh "$TAG"
SCRIPTEOF`,
      'chmod +x /usr/local/bin/sitelog-deploy',
    );

    const server = new ec2.Instance(this, 'Server', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: new ec2.InstanceType(settings.instanceType),
      machineImage: ec2.MachineImage.latestAmazonLinux2023({
        cpuType: ec2.AmazonLinuxCpuType.ARM_64,
      }),
      securityGroup: serverSecurityGroup,
      role,
      userData,
      requireImdsv2: true,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(20, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
          }),
        },
      ],
    });

    Tags.of(server).add('sitelog:env', envName);

    // A fixed public IP for the DNS record.
    const ip = new ec2.CfnEIP(this, 'PublicIp', { domain: 'vpc' });

    new ec2.CfnEIPAssociation(this, 'PublicIpAssociation', {
      allocationId: ip.attrAllocationId,
      instanceId: server.instanceId,
    });

    // Alarms mail the address in cdk.json; EC2 also restarts itself on a hardware fault.
    const topic = new sns.Topic(this, 'Alarms', { topicName: `sitelog-${envName}-alarms` });

    if (settings.alarmEmail !== '') {
      topic.addSubscription(new subscriptions.EmailSubscription(settings.alarmEmail));
    }
    const notify = new actions.SnsAction(topic);

    const systemCheck = new cloudwatch.Alarm(this, 'ServerSystemCheck', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/EC2',
        metricName: 'StatusCheckFailed_System',
        dimensionsMap: { InstanceId: server.instanceId },
        period: Duration.minutes(1),
        statistic: 'Maximum',
      }),
      threshold: 1,
      evaluationPeriods: 2,
    });

    systemCheck.addAlarmAction(new actions.Ec2Action(actions.Ec2InstanceAction.RECOVER), notify);

    const instanceCheck = new cloudwatch.Alarm(this, 'ServerInstanceCheck', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/EC2',
        metricName: 'StatusCheckFailed_Instance',
        dimensionsMap: { InstanceId: server.instanceId },
        period: Duration.minutes(1),
        statistic: 'Maximum',
      }),
      threshold: 1,
      evaluationPeriods: 3,
    });

    instanceCheck.addAlarmAction(new actions.Ec2Action(actions.Ec2InstanceAction.REBOOT), notify);

    const lowStorage = new cloudwatch.Alarm(this, 'DatabaseLowStorage', {
      metric: database.metricFreeStorageSpace({ period: Duration.minutes(5) }),
      threshold: 2 * 1024 * 1024 * 1024,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 1,
    });

    lowStorage.addAlarmAction(notify);

    const busyDatabase = new cloudwatch.Alarm(this, 'DatabaseCpu', {
      metric: database.metricCPUUtilization({ period: Duration.minutes(5) }),
      threshold: 80,
      evaluationPeriods: 3,
    });

    busyDatabase.addAlarmAction(notify);

    // Counts 5xx answers in the API's JSON logs.
    const errors = new logs.MetricFilter(this, 'Api5xx', {
      logGroup: logGroups[0]!,
      metricNamespace: 'SiteLog',
      metricName: `${envName}-api-5xx`,
      filterPattern: logs.FilterPattern.numberValue('$.res.statusCode', '>=', 500),
      metricValue: '1',
      defaultValue: 0,
    });
    const serverErrors = new cloudwatch.Alarm(this, 'Api5xxAlarm', {
      metric: errors.metric({ period: Duration.minutes(5), statistic: 'Sum' }),
      threshold: 5,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    serverErrors.addAlarmAction(notify);

    new CfnOutput(this, 'PublicIpAddress', {
      value: ip.ref,
      description: `A record for ${settings.apiDomain}`,
    });
    new CfnOutput(this, 'InstanceId', { value: server.instanceId });
    new CfnOutput(this, 'BucketName', { value: bucket.bucketName });
    new CfnOutput(this, 'DatabaseEndpoint', { value: database.dbInstanceEndpointAddress });
    new CfnOutput(this, 'DatabaseSecretArn', { value: database.secret!.secretArn });
  }
}

import { CfnOutput, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';

interface SharedStackProps extends StackProps {
  githubRepo: string;
}

export class SharedStack extends Stack {
  readonly repository: ecr.Repository;

  constructor(scope: Construct, id: string, props: SharedStackProps) {
    super(scope, id, props);

    // One image repository; staging and prod run the same image, tagged with the git commit.
    this.repository = new ecr.Repository(this, 'Api', {
      repositoryName: 'sitelog-api',
      imageScanOnPush: true,
      lifecycleRules: [{ maxImageCount: 30 }],
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // GitHub Actions logs in with a short-lived token instead of stored AWS keys.
    const github = new iam.OidcProviderNative(this, 'GitHubOidc', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

    const deployRole = new iam.Role(this, 'GitHubDeploy', {
      roleName: 'sitelog-github-deploy',
      assumedBy: new iam.WebIdentityPrincipal(github.oidcProviderArn, {
        StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
        // Only this repository: the image job on main or a v* tag, and the two deploy
        // environments (a job with `environment:` gets an environment subject instead of a ref).
        StringLike: {
          'token.actions.githubusercontent.com:sub': [
            `repo:${props.githubRepo}:ref:refs/heads/main`,
            `repo:${props.githubRepo}:ref:refs/tags/v*`,
            `repo:${props.githubRepo}:environment:staging`,
            `repo:${props.githubRepo}:environment:production`,
          ],
        },
      }),
    });

    this.repository.grantPullPush(deployRole);
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ssm:SendCommand'],
        resources: [`arn:aws:ssm:${this.region}::document/AWS-RunShellScript`],
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ssm:SendCommand'],
        resources: [`arn:aws:ec2:${this.region}:${this.account}:instance/*`],
        // Only the SiteLog servers.
        conditions: { StringLike: { 'ssm:resourceTag/sitelog:env': ['staging', 'prod'] } },
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetCommandInvocation', 'ec2:DescribeInstances'],
        resources: ['*'],
      }),
    );

    new CfnOutput(this, 'RepositoryUri', { value: this.repository.repositoryUri });
    new CfnOutput(this, 'DeployRoleArn', { value: deployRole.roleArn });
  }
}

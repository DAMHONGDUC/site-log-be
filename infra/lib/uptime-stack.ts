import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import type { Construct } from 'constructs';

interface UptimeStackProps extends StackProps {
  apiDomain: string;
  alarmEmail: string;
}

// Checks https://<domain>/health from several places in the world every 30 s.
export class UptimeStack extends Stack {
  constructor(scope: Construct, id: string, props: UptimeStackProps) {
    super(scope, id, props);

    const check = new route53.CfnHealthCheck(this, 'Health', {
      healthCheckConfig: {
        type: 'HTTPS_STR_MATCH',
        fullyQualifiedDomainName: props.apiDomain,
        port: 443,
        resourcePath: '/health',
        searchString: '"ok"',
        requestInterval: 30,
        failureThreshold: 3,
      },
    });

    const topic = new sns.Topic(this, 'Alarms', { topicName: 'sitelog-prod-uptime' });
    if (props.alarmEmail !== '') {
      topic.addSubscription(new subscriptions.EmailSubscription(props.alarmEmail));
    }

    const down = new cloudwatch.Alarm(this, 'ApiDown', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/Route53',
        metricName: 'HealthCheckStatus',
        dimensionsMap: { HealthCheckId: check.attrHealthCheckId },
        period: Duration.minutes(1),
        statistic: 'Minimum',
      }),
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    });
    down.addAlarmAction(new actions.SnsAction(topic));

    new CfnOutput(this, 'HealthCheckId', { value: check.attrHealthCheckId });
  }
}

import { SecurityGroup } from "@aws-cdk/aws-ec2";

import {
  ApplicationListener,
  ApplicationLoadBalancer,
  ApplicationTargetGroup
} from "@aws-cdk/aws-elasticloadbalancingv2";

export interface LoadBalancerResources {
  loadBalancer: ApplicationLoadBalancer;
  listener: ApplicationListener;
  loadBalancerSecurityGroup: SecurityGroup;
  blueTargetGroup: ApplicationTargetGroup;
  greenTargetGroup: ApplicationTargetGroup;
}

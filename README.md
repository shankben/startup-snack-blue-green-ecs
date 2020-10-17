# Blue-Green Deployments for Amazon Elastic Container Service using AWS Cloud Development Kit

This project recasts into an AWS Cloud Development Kit (CDK) application the [prescriptive guidance](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/blue-green.html) for using CloudFormation's blue-green deployment strategy for Amazon Elastic Container Service (ECS).

As a simple example, this application uses one ECS Fargate service with the public `nginxdemos` Docker image. To demonstrate the blue-green deployment strategy, specify as a CDK context variable the particular Docker image tag for `nginxdemos` to deploy. If not specified at the command line, `latest` will be used for the default image tag.

## Setup

  * `npm install`
  * `npm run build`
  * `cdk deploy -c image-tag=[latest|plain-text]`

## Useful Commands

  * `npm run build`   compile project to `dist`.
  * `npm run clean`   delete everything in `cdk.out` and `dist`.
  * `npm run watch`   watch for changes and compile.
  * `cdk deploy`      deploy this stack to your default AWS account/region.
  * `cdk diff`        compare deployed stack with current state.
  * `cdk synth`       emits the synthesized CloudFormation template.

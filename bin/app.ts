import "source-map-support/register";
import * as cdk from "@aws-cdk/core";
import { ServiceStack } from "../lib/stacks/service";

const props = {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.AWS_REGION ??
      process.env.CDK_DEPLOY_REGION ??
      process.env.CDK_DEFAULT_REGION ??
      "us-east-1"
  }
};

const app = new cdk.App();

const serviceStack = new ServiceStack(app, "StartupSnack-BlueGreenEcsStack", {
  ...props,
  imageTag: app.node.tryGetContext("image-tag") ?? "latest"
});

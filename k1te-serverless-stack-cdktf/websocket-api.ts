import { Apigatewayv2Api } from "@cdktf/provider-aws/lib/apigatewayv2-api";
import { TerraformOutput } from "cdktf";

import { AcmCertificate } from "@cdktf/provider-aws/lib/acm-certificate";
import { AcmCertificateValidation } from "@cdktf/provider-aws/lib/acm-certificate-validation";
import { ApiGatewayAccount } from "@cdktf/provider-aws/lib/api-gateway-account";
import { Apigatewayv2ApiMapping } from "@cdktf/provider-aws/lib/apigatewayv2-api-mapping";
import { Apigatewayv2DomainName } from "@cdktf/provider-aws/lib/apigatewayv2-domain-name";
import { Apigatewayv2Integration } from "@cdktf/provider-aws/lib/apigatewayv2-integration";
import { Apigatewayv2IntegrationResponse } from "@cdktf/provider-aws/lib/apigatewayv2-integration-response";
import { Apigatewayv2Route } from "@cdktf/provider-aws/lib/apigatewayv2-route";
import { Apigatewayv2RouteResponse } from "@cdktf/provider-aws/lib/apigatewayv2-route-response";
import { Apigatewayv2Stage } from "@cdktf/provider-aws/lib/apigatewayv2-stage";
import { CloudwatchLogGroup } from "@cdktf/provider-aws/lib/cloudwatch-log-group";
import { LambdaPermission } from "@cdktf/provider-aws/lib/lambda-permission";
import { DataCloudflareZone } from "@cdktf/provider-cloudflare/lib/data-cloudflare-zone";
import { CloudflareProvider } from "@cdktf/provider-cloudflare/lib/provider";
import { Record } from "@cdktf/provider-cloudflare/lib/record";
import { Construct } from "constructs";
import { ExecuteApi } from "iam-floyd";
import { Role } from "./iam";
import { Lambda } from "./lambda";
import assert = require("node:assert");

const PING_REQUEST_TEMPLATE = JSON.stringify({ statusCode: 200 });

const PONG_RESPONSE_TEMPLATE = JSON.stringify([
  "PONG",
  "$context.connectionId",
]);

export type WebsocketApiProps = {
  handler: Lambda;
  stage?: string;
  logRetentionDays?: number;
};

export const API_GATEWAY_SERVICE_PRINCIPAL = "apigateway.amazonaws.com";
export class WebsocketApi extends Construct {
  readonly api: Apigatewayv2Api;
  readonly role: Role;
  readonly cert?: AcmCertificate;
  readonly domainName?: Apigatewayv2DomainName;

  constructor(scope: Construct, id: string, domainName?: string) {
    super(scope, id);

    this.role = new Role(this, `${id}-execution-role`, {
      forService: API_GATEWAY_SERVICE_PRINCIPAL,
    });

    this.role.attachManagedPolicyArn(
      "arn:aws:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs"
    );

    const account = new ApiGatewayAccount(this, `${id}-account`, {
      cloudwatchRoleArn: this.role.arn,
    });

    this.api = new Apigatewayv2Api(this, id, {
      name: id,
      protocolType: "WEBSOCKET",
      routeSelectionExpression: "$request.body.[0]", // "\\$default",
      dependsOn: [account],
    });

    new CloudwatchLogGroup(this, `${id}-welcome-logs`, {
      name: "/aws/apigateway/welcome",
      retentionInDays: 1,
    });

    if (!domainName) return;

    const apiToken = process.env.CLOUDFLARE_API_TOKEN;

    // CLOUDFLARE_API_TOKEN must be configured
    assert(
      apiToken,
      "CLOUDFLARE_API_TOKEN env variable is not configured in .env"
    );

    new CloudflareProvider(this, "cloudflare-provider", {
      apiToken,
    });

    const cloudflareZone = new DataCloudflareZone(this, `${domainName}-zone`, {
      name: domainName,
    });

    const wildcardDomain = "*." + domainName;
    this.cert = new AcmCertificate(this, `${domainName}-certificate`, {
      domainName,
      subjectAlternativeNames: [wildcardDomain],
      validationMethod: "DNS",
      lifecycle: {
        createBeforeDestroy: true,
      },
    });

    // If cert is requested only for apex and wildcard domains, validation records appear to be
    // identical. There exists an error related to that:
    // https://github.com/hashicorp/terraform-provider-aws/issues/16913
    // As a workaround, we only create one of them.

    const validationOption = this.cert.domainValidationOptions.get(1);

    const validationRecord = new Record(
      this,
      `${domainName}-validation-record`,
      {
        zoneId: cloudflareZone.zoneId,
        name: validationOption.resourceRecordName,
        type: validationOption.resourceRecordType,
        value: validationOption.resourceRecordValue,
        proxied: false, // CNAME records cannot be proxied
        ttl: 1, // 1 means Auto
        /* Cloudflare free tier does not allow tags, but we need empty array to prevent the tagging 
         aspect from adding invalid tag. 
         
         In case tags willbe added sometimes, keep in mind, that unlike AWS, Cloudflare tags 
          are simple strings, not objects. 
          
          Convention is to have keys and values separated by colon, like ["app:k1te-chat"]
       */
        tags: [],
      }
    );

    // Iterators currently fail for sets: https://github.com/hashicorp/terraform-cdk/issues/2001
    // const validationOptions: ListTerraformIterator = TerraformIterator.fromList(
    //   this.cert.domainValidationOptions
    // );
    // Workaround was taken from https://github.com/hashicorp/terraform-cdk/issues/430#issuecomment-1288006312
    // and slightly modified
    // But it still does not work due to the bug with duplicated validation records mentioned above.
    // I decided to keep workaround here commented out in the case we will need to add domain names
    // To the certificate sometimes.
    // NOSONAR
    // validationRecord.addOverride(
    //   "for_each",
    //   `\${{for dvo in ${this.cert.fqn}.domain_validation_options : dvo.domain_name => {
    //   name=dvo.resource_record_name
    //   type=dvo.resource_record_type
    //   value=dvo.resource_record_value
    //   }}}`
    // );

    const certValidation = new AcmCertificateValidation(
      this,
      `${domainName}-certificate-validation`,
      {
        certificateArn: this.cert.arn,
        dependsOn: [validationRecord],
      }
    );

    // Part of commented out workaround explained above
    // certValidation.addOverride(
    //   "validation_record_fqdns",
    //   `\${[for record in ${validationRecords.fqn} : record.hostname]}`
    // );

    const alias = "ws." + domainName;

    this.domainName = new Apigatewayv2DomainName(this, `${id}-domain-name`, {
      domainName: alias,
      domainNameConfiguration: {
        certificateArn: this.cert.arn,
        endpointType: "REGIONAL",
        securityPolicy: "TLS_1_2",
      },
      dependsOn: [certValidation],
    });

    new Record(this, `${alias}-cname-record`, {
      zoneId: cloudflareZone.zoneId,
      name: alias,
      type: "CNAME",
      value: this.domainName.domainNameConfiguration.targetDomainName,
      proxied: false,
      ttl: 1,
      tags: [],
    });
  }

  public addStage(props: Readonly<WebsocketApiProps>) {
    const {
      handler,
      stage: name = "prod",
      logRetentionDays: retentionInDays = 7,
    } = props;

    const id = this.node.id;

    const accessLogGroup = new CloudwatchLogGroup(
      this,
      `${id}-${name}-access-logs`,
      {
        name: `/aws/apigateway/${id}/${name}/access-logs`,
        retentionInDays,
      }
    );

    new CloudwatchLogGroup(this, `${id}-${name}-execution-logs`, {
      name: `/aws/apigateway/${id}/${name}`,
      retentionInDays,
    });

    const stage = new Apigatewayv2Stage(this, `${id}-${name}-stage`, {
      apiId: this.api.id,
      name,
      autoDeploy: true,
      accessLogSettings: {
        destinationArn: accessLogGroup.arn,
        format: JSON.stringify({
          requestId: "$context.requestId",
          ip: "$context.identity.sourceIp",
          caller: "$context.identity.caller",
          user: "$context.identity.user",
          requestTime: "$context.requestTime",
          eventType: "$context.eventType",
          routeKey: "$context.routeKey",
          status: "$context.status",
          connectionId: "$context.connectionId",
        }),
      },
      defaultRouteSettings: {
        dataTraceEnabled: true,
        loggingLevel: "INFO",
        detailedMetricsEnabled: false,
        throttlingRateLimit: 1000,
        throttlingBurstLimit: 500,
      },
    });

    const integration = new Apigatewayv2Integration(
      this,
      `${id}-${name}-default-integration`,
      {
        apiId: this.api.id,
        integrationType: "AWS_PROXY",
        integrationUri: handler.fn.arn,
        credentialsArn: this.role.arn,
        contentHandlingStrategy: "CONVERT_TO_TEXT",
        passthroughBehavior: "WHEN_NO_MATCH",
      }
    );

    new Apigatewayv2IntegrationResponse(
      this,
      `${id}-${name}-default-integration-response`,
      {
        apiId: this.api.id,
        integrationId: integration.id,
        integrationResponseKey: "/200/",
      }
    );

    const defaultRoute = new Apigatewayv2Route(
      this,
      `${id}-${name}-default-route`,
      {
        apiId: this.api.id,
        routeKey: "$default",
        target: "integrations/" + integration.id,
      }
    );

    new Apigatewayv2RouteResponse(
      this,
      `${id}-${name}-default-route-response`,
      {
        apiId: this.api.id,
        routeId: defaultRoute.id,
        routeResponseKey: "$default",
      }
    );

    const connectRoute = new Apigatewayv2Route(
      this,
      `${id}-${name}-connect-route`,
      {
        apiId: this.api.id,
        routeKey: "$connect",
        target: "integrations/" + integration.id,
      }
    );

    new Apigatewayv2RouteResponse(
      this,
      `${id}-${name}-connect-route-response`,
      {
        apiId: this.api.id,
        routeId: connectRoute.id,
        routeResponseKey: "$default",
      }
    );

    const disconnectRoute = new Apigatewayv2Route(
      this,
      `${id}-${name}-disconnect-route`,
      {
        apiId: this.api.id,
        routeKey: "$disconnect",
        target: "integrations/" + integration.id,
      }
    );

    new Apigatewayv2RouteResponse(
      this,
      `${id}-${name}-disconnect-route-response`,
      {
        apiId: this.api.id,
        routeId: disconnectRoute.id,
        routeResponseKey: "$default",
      }
    );

    // PING

    const pingIntegration = new Apigatewayv2Integration(
      this,
      `${id}-${name}-ping-integration`,
      {
        apiId: this.api.id,
        integrationType: "MOCK",
        templateSelectionExpression: "200",
        requestTemplates: {
          "200": PING_REQUEST_TEMPLATE,
        },
      }
    );

    new Apigatewayv2IntegrationResponse(
      this,
      `${id}-${name}-ping-integration-response`,
      {
        apiId: this.api.id,
        integrationId: pingIntegration.id,
        integrationResponseKey: "/200/",
        templateSelectionExpression: "200",
        responseTemplates: {
          "200": PONG_RESPONSE_TEMPLATE,
        },
      }
    );

    const pingRoute = new Apigatewayv2Route(this, `${id}-${name}-ping-route`, {
      apiId: this.api.id,
      routeKey: "PING",
      routeResponseSelectionExpression: "$default",
      target: "integrations/" + pingIntegration.id,
    });

    new Apigatewayv2RouteResponse(this, `${id}-${name}-ping-route-response`, {
      apiId: this.api.id,
      routeId: pingRoute.id,
      routeResponseKey: "$default",
    });

    handler.allowToInvoke(this.role);

    /*
     * We cannot use token to define policy resource, like
     * '.on(stage.executionArn)' as it causes terraform cycle
     */
    const policyStatement = new ExecuteApi()
      .allow()
      .allActions()
      .onExecuteApiGeneral(this.node.id, name, "*", "*");

    handler.role.grant(
      `allow-execute-api-${this.node.id}-${name}`,
      policyStatement
    );

    new LambdaPermission(this, `${id}-${name}-lambda-permission`, {
      functionName: handler.fn.functionName,
      action: "lambda:InvokeFunction",
      principal: API_GATEWAY_SERVICE_PRINCIPAL,
      sourceArn: `${this.api.executionArn}/*/*`,
    });

    // Outputs the WebSocket URL
    new TerraformOutput(this, `${id}-${name}-url`, {
      value: stage.invokeUrl,
    });

    if (this.domainName) {
      const nameMapping = new Apigatewayv2ApiMapping(
        this,
        `${id}-${name}-name-mapping`,
        {
          apiId: this.api.id,
          domainName: this.domainName.domainName,
          stage: stage.name,
          apiMappingKey: stage.name,
        }
      );

      // Outputs the WebSocket URL
      new TerraformOutput(this, `${id}-${name}-mapped-url`, {
        value: `wss://${nameMapping.domainName}/${name}`,
      });
    }

    return this;
  }
}
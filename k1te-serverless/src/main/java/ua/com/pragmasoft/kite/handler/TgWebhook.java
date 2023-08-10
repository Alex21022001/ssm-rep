package ua.com.pragmasoft.kite.handler;

import jakarta.inject.Inject;
import jakarta.inject.Named;

import java.util.Map;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import com.amazonaws.services.lambda.runtime.events.APIGatewayV2HTTPEvent;
import com.amazonaws.services.lambda.runtime.events.APIGatewayV2HTTPResponse;

import io.quarkus.logging.Log;

@Named("tg")
public class TgWebhook implements RequestHandler<APIGatewayV2HTTPEvent, APIGatewayV2HTTPResponse> {

  @Inject
  ProcessingService service;

  @Override
  public APIGatewayV2HTTPResponse handleRequest(APIGatewayV2HTTPEvent input, Context context) {
    final var response = new APIGatewayV2HTTPResponse();
    response.setBody("OK");
    response.setStatusCode(200);
    response.setHeaders(Map.of("Content-Type", "text/plain"));
    Log.infof("tg %s -> %s (%s)", input, response, context);
    return response;
  }
}
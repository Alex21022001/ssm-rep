package ua.com.pragmasoft.k1te.backend.ws;

import java.io.Closeable;
import java.io.IOException;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import ua.com.pragmasoft.k1te.backend.router.domain.Channels;
import ua.com.pragmasoft.k1te.backend.router.domain.Connector;
import ua.com.pragmasoft.k1te.backend.router.domain.Member;
import ua.com.pragmasoft.k1te.backend.router.domain.Router;
import ua.com.pragmasoft.k1te.backend.router.domain.RoutingContext;
import ua.com.pragmasoft.k1te.backend.router.domain.payload.ErrorResponse;
import ua.com.pragmasoft.k1te.backend.router.domain.payload.JoinChannel;
import ua.com.pragmasoft.k1te.backend.router.domain.payload.MessageAck;
import ua.com.pragmasoft.k1te.backend.router.domain.payload.MessagePayload;
import ua.com.pragmasoft.k1te.backend.router.domain.payload.OkResponse;
import ua.com.pragmasoft.k1te.backend.router.domain.payload.Payload;
import ua.com.pragmasoft.k1te.backend.router.domain.payload.Ping;
import ua.com.pragmasoft.k1te.backend.router.domain.payload.PlaintextMessage;
import ua.com.pragmasoft.k1te.backend.router.domain.payload.Pong;
import ua.com.pragmasoft.k1te.backend.shared.KiteException;
import ua.com.pragmasoft.k1te.backend.shared.RoutingException;

public class WsConnector implements Connector {

  private static final Logger log = LoggerFactory.getLogger(WsConnector.class);

  public static final String SUBPROTOCOL = "k1te.chat.v1";

  private static final String WS = "ws";

  private final Router router;

  private final Channels channels;

  private final WsConnectionRegistry connections;

  public WsConnector(final Router router, final Channels channels, final WsConnectionRegistry connections) {
    this.router = router;
    router.registerConnector(this);
    this.channels = channels;
    this.connections = connections;
  }

  @Override
  public String id() {
    return WS;
  }

  public Payload onOpen(WsConnection connection) {
    if (log.isDebugEnabled()) {
      final var connectionUri = this.connectionUriOf(connection);
      log.debug("Member connected to channel on {}", connectionUri);
    }
    return null;
  }

  public Payload onClose(WsConnection connection) {
    final var connectionUri = this.connectionUriOf(connection);
    log.debug("Member disconnected from channel on {}", connectionUri);
    Member client = this.channels.find(connectionUri);
    this.router.dispatch(
        RoutingContext
            .create()
            .withOriginConnection(connectionUri)
            .withRequest(new PlaintextMessage(
                "✅ %s left channel %s".formatted(client.getUserName(), client.getChannelName()))));
    this.channels.leaveChannel(connectionUri);
    return null;
  }

  public Payload onError(WsConnection connection, Throwable t) {
    if (log.isErrorEnabled()) {
      log.error("Error on connection %s".formatted(connection.connectionUri()), t);
    }
    final ErrorResponse errorResponse;
    if (t instanceof KiteException ke) {
      errorResponse = new ErrorResponse("⛔ " + ke.getMessage(), ke.code());
    } else {
      errorResponse = new ErrorResponse("⛔ " + t.getMessage(), KiteException.SERVER_ERROR);
    }
    return errorResponse;
  }

  public Payload onPayload(Payload payload, WsConnection connection) {
    if (payload instanceof MessagePayload message) {
      return this.onMessage(message, connection);
    } else if (payload instanceof Ping) {
      return new Pong();
    } else if (payload instanceof JoinChannel joinCommand) {
      return this.onJoinChannel(joinCommand, connection);
    } else {
      throw new IllegalStateException(
          "Unsupported payload type %s".formatted(payload.getClass().getSimpleName()));
    }
  }

  private Payload onJoinChannel(JoinChannel joinChannel, WsConnection connection) {
    log.debug("Join member {} to channel {}", joinChannel.memberId(), joinChannel.channelName());
    String originConnection = this.connectionUriOf(connection);
    Member client = this.channels.joinChannel(joinChannel.channelName(), joinChannel.memberId(), originConnection,
        joinChannel.memberName());
    var ctx = RoutingContext.create()
        .withOriginConnection(originConnection)
        .withFrom(client)
        .withRequest(new PlaintextMessage(
            "✅ %s joined channel %s".formatted(client.getUserName(), client.getChannelName())));
    this.router.dispatch(ctx);
    return new OkResponse();
  }

  private Payload onMessage(MessagePayload message, WsConnection connection) {
    log.debug("Message {}", message);
    var originConnection = this.connectionUriOf(connection);
    var ctx = RoutingContext.create()
        .withOriginConnection(originConnection)
        .withRequest(message);
    this.router.dispatch(ctx);
    return ctx.response;
  }

  @Override
  public void dispatch(RoutingContext ctx) {
    var messagePayload = ctx.request;
    WsConnection connection = this.requiredConnection(ctx.destinationConnection);
    try {
      connection.sendObject(messagePayload);
    } catch (IOException e) {
      throw new RoutingException(e.getMessage(), e);
    }
    ctx.response = new MessageAck(messagePayload.messageId());
  }

  private String connectionUriOf(WsConnection c) {
    return this.connectionUri(c.connectionUri());
  }

  private WsConnection requiredConnection(String uri) {
    var connection = this.connections.getConnection(this.rawConnection(uri));
    if (null == connection) {
      throw new RoutingException("Web client disconnected");
    }
    return connection;
  }

  public static interface WsConnection extends Closeable {

    public String connectionUri();

    public void sendObject(Payload payload) throws IOException;

  }

  public static interface WsConnectionRegistry {

    WsConnection getConnection(String connectionUri);

  }

}

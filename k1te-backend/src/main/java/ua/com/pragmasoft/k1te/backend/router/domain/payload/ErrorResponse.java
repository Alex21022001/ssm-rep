package ua.com.pragmasoft.k1te.backend.router.domain.payload;

public record ErrorResponse(String reason, int code) implements Payload {

  @Override
  public Type type() {
    return Type.ERR;
  }

}

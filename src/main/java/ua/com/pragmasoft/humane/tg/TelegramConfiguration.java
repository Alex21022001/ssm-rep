package ua.com.pragmasoft.humane.tg;

import java.net.URI;
import javax.enterprise.context.ApplicationScoped;
import javax.enterprise.inject.Produces;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import com.pengrad.telegrambot.TelegramBot;
import ua.com.pragmasoft.k1te.chat.Router;

public class TelegramConfiguration {

  @Produces
  @ApplicationScoped
  public TelegramBot botClient(@ConfigProperty(name = "bot.token") String token) {
    return new TelegramBot(token);
  }

  @Produces
  @ApplicationScoped
  public TelegramConnector botConnector(TelegramBot botClient, Router router,
      @ConfigProperty(name = "webhook.host") final URI webhookHost) {
    return new TelegramConnector(botClient, router, webhookHost);
  }
}
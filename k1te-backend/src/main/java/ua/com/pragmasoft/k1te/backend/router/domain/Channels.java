/* LGPL 3.0 ©️ Dmytro Zemnytskyi, pragmasoft@gmail.com, 2023 */
package ua.com.pragmasoft.k1te.backend.router.domain;

public interface Channels {

  Member hostChannel(String channel, String memberId, String ownerConnection, String title);

  Member dropChannel(String ownerConnection);

  Member joinChannel(String channelName, String memberId, String connection, String memberName);

  Member leaveChannel(String connection);

  Member find(String memberConnection);

  Member find(String channel, String memberId);

  Integer findPinnedMessage(Member from, Member to);

  void updatePeer(Member member, String peerMemberId);

  void updatePinnedMessageId(Member from, Member to, Integer pinnedMessagedId);

  void deletePinnedMessage(Member from, Member to);
}

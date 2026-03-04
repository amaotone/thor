export type Platform = 'discord';

export interface ChannelMessageSenderPort {
  sendMessage(channelId: string, message: string): Promise<void>;
}

export type SendMessageFn = (channelId: string, message: string) => Promise<void>;

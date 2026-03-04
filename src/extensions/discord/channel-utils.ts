/** sendメソッドを持つチャンネルかどうか判定する型ガード */
export interface SendableChannel {
  send(
    content:
      | string
      | { content: string; allowedMentions: { parse: never[] } }
      | { files: { attachment: string }[] }
  ): Promise<unknown>;
  name?: string;
}

export function isSendableChannel(channel: unknown): channel is SendableChannel {
  return channel != null && typeof (channel as SendableChannel).send === 'function';
}

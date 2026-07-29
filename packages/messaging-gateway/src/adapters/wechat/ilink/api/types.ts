// Vendored from @tencent-weixin/openclaw-weixin@2.4.4 (MIT, Copyright (C) 2026 Tencent).
// See ../LICENSE and ../README.md (paths relative to ilink/) for license text and local adaptations.

/** iLink base app information. */
export interface BaseInfo {
  appid: string;
  [key: string]: unknown;
}

/** Upload media type constants. */
export const UploadMediaType = {
  IMAGE: 1,
  VIDEO: 2,
  FILE: 3,
  VOICE: 4,
} as const;
export type UploadMediaType =
  (typeof UploadMediaType)[keyof typeof UploadMediaType];

/** Request to obtain an upload URL for a media file. */
export interface GetUploadUrlReq {
  media_type: UploadMediaType;
  file_size: number;
  file_name?: string;
  md5?: string;
}

/** Response containing the upload URL and credentials. */
export interface GetUploadUrlResp {
  ret: number;
  errcode: number;
  errmsg: string;
  url?: string;
  token?: string;
  expires_in_ms?: number;
}

/** Message type constants — distinguishes user vs bot origin. */
export const MessageType = {
  NONE: 0,
  USER: 1,
  BOT: 2,
} as const;
export type MessageType = (typeof MessageType)[keyof typeof MessageType];

/** Message item type constants. */
export const MessageItemType = {
  NONE: 0,
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
  TOOL_CALL_START: 11,
  TOOL_CALL_RESULT: 12,
} as const;
export type MessageItemType =
  (typeof MessageItemType)[keyof typeof MessageItemType];

/** Message state constants. */
export const MessageState = {
  NEW: 0,
  GENERATING: 1,
  FINISH: 2,
} as const;
export type MessageState = (typeof MessageState)[keyof typeof MessageState];

/** Text message content item. */
export interface TextItem {
  content: string;
}

/** CDN media descriptor with encryption parameters. */
export interface CDNMedia {
  encrypt_query_param: string;
  aes_key: string;
  encrypt_type: number;
  full_url: string;
}

/** Image message content item. */
export interface ImageItem {
  media: CDNMedia;
  thumb_media?: CDNMedia;
  aeskey?: string;
  url?: string;
  mid_size?: number;
  thumb_size?: number;
  width?: number;
  height?: number;
  md5?: string;
}

/** Voice message content item. */
export interface VoiceItem {
  media: CDNMedia;
  encode_type?: number;
  bits_per_sample?: number;
  sample_rate?: number;
  playtime?: number;
  text?: string;
}

/** File message content item. */
export interface FileItem {
  media: CDNMedia;
  file_name: string;
  md5: string;
  len: number;
}

/** Video message content item. */
export interface VideoItem {
  media: CDNMedia;
  video_size?: number;
  play_length?: number;
  video_md5?: string;
  thumb_media?: CDNMedia;
  width?: number;
  height?: number;
}

/** Metadata for a referenced/original message. */
export interface RefMessage {
  msg_id: string;
  seq?: number;
  sender_id?: string;
}

/** Tool-call start item (function-calling invocation). */
export interface ToolCallStartItem {
  tool_call_id: string;
  function_name: string;
  arguments: string;
}

/** Tool-call result item (function-calling response). */
export interface ToolCallResultItem {
  tool_call_id: string;
  function_name: string;
  result: string;
  is_error?: boolean;
}

/** Union message item — at most one content sub-object is populated per type. */
export interface MessageItem {
  type: MessageItemType;
  create_time_ms: number;
  update_time_ms: number;
  is_completed: boolean;
  msg_id: string;
  ref_msg?: RefMessage;
  text_item?: TextItem;
  image_item?: ImageItem;
  voice_item?: VoiceItem;
  file_item?: FileItem;
  video_item?: VideoItem;
  tool_call_start_item?: ToolCallStartItem;
  tool_call_result_item?: ToolCallResultItem;
}

/** Top-level Weixin message envelope. All fields are optional for request construction. */
export interface WeixinMessage {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  update_time_ms?: number;
  delete_time_ms?: number;
  session_id?: string;
  group_id?: string;
  message_type?: number;
  message_state?: number;
  item_list?: MessageItem[];
  context_token?: string;
  run_id?: string;
}

/** Request to poll for new messages. */
export interface GetUpdatesReq {
  session_id?: string;
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

/** Response containing new messages. */
export interface GetUpdatesResp {
  ret: number;
  errcode: number;
  errmsg: string;
  msgs: WeixinMessage[];
  get_updates_buf: string;
  longpolling_timeout_ms: number;
}

/** Request to send a message: wraps a WeixinMessage under `msg`. */
export interface SendMessageReq {
  msg?: WeixinMessage;
}

/** Response after sending a message. */
export interface SendMessageResp {
  ret?: number;
  errcode?: number;
  errmsg?: string;
}

/** Typing-indicator status constants. */
export const TypingStatus = {
  TYPING: 1,
  CANCEL: 2,
} as const;
export type TypingStatus = (typeof TypingStatus)[keyof typeof TypingStatus];

/** Request to notify typing status. */
export interface SendTypingReq {
  to_user_id?: string;
  typing_status?: TypingStatus;
  session_id?: string;
  /** iLink user id (from message context). */
  ilink_user_id?: string;
  /** Typing ticket from getConfig. */
  typing_ticket?: string;
  /** 1=typing, 2=cancel. */
  status?: number;
}

/** Response to typing notification. */
export interface SendTypingResp {
  ret: number;
  errcode: number;
  errmsg: string;
}

/** Response containing bot / channel configuration. */
export interface GetConfigResp {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  /** Base64-encoded typing ticket for sendTyping. */
  typing_ticket?: string;
  [key: string]: unknown;
}

/** Request to notify the bot should stop (e.g. stop generating). */
export interface NotifyStopReq {
  session_id: string;
  message_id: string;
  run_id?: string;
}

/** Response to stop notification. */
export interface NotifyStopResp {
  ret: number;
  errcode: number;
  errmsg: string;
}

/** Request to notify the bot should start / resume. */
export interface NotifyStartReq {
  session_id: string;
  message_id?: string;
  run_id?: string;
  client_id?: string;
}

/** Response to start notification. */
export interface NotifyStartResp {
  ret: number;
  errcode: number;
  errmsg: string;
}

/**
 * Inbound wire-format regression tests for the iLink WeChat transport.
 *
 * The upstream @tencent-weixin/openclaw-weixin wire format carries text under
 * `text_item.text`. A local vendoring rename to `text_item.content` silently
 * broke inbound text extraction (and outbound delivery) — every message body
 * came through empty, so chat commands like `/pair <code>` never reached the
 * command handler. These tests pin the official wire shape.
 */
import { describe, it, expect } from 'bun:test'

import {
  bodyFromItemList,
  weixinMessageToMsgContext,
} from '../adapters/wechat/ilink/messaging/inbound'
import { MessageItemType } from '../adapters/wechat/ilink/api/types'
import type { MessageItem, WeixinMessage } from '../adapters/wechat/ilink/api/types'

/** Build a MessageItem with the required envelope fields filled in. */
function item(partial: Partial<MessageItem> & { type: MessageItemType }): MessageItem {
  return {
    create_time_ms: 0,
    update_time_ms: 0,
    is_completed: true,
    msg_id: `m${Math.random().toString(36).slice(2, 8)}`,
    ...partial,
  }
}

describe('bodyFromItemList (official wire format: text_item.text)', () => {
  it('extracts text from text_item.text', () => {
    expect(
      bodyFromItemList([item({ type: MessageItemType.TEXT, text_item: { text: '/pair 123456' } })]),
    ).toBe('/pair 123456')
  })

  it('returns empty string when the text lives under the legacy content key', () => {
    expect(
      bodyFromItemList([item({ type: MessageItemType.TEXT, text_item: { content: 'ghost' } as never })]),
    ).toBe('')
  })

  it('concatenates multiple text items with newlines', () => {
    expect(
      bodyFromItemList([
        item({ type: MessageItemType.TEXT, text_item: { text: 'a' } }),
        item({ type: MessageItemType.TEXT, text_item: { text: 'b' } }),
      ]),
    ).toBe('a\nb')
  })

  it('returns empty string for empty or text-less item lists', () => {
    expect(bodyFromItemList(undefined)).toBe('')
    expect(bodyFromItemList([])).toBe('')
    expect(bodyFromItemList([item({ type: MessageItemType.IMAGE })])).toBe('')
  })
})

describe('weixinMessageToMsgContext text extraction', () => {
  it('carries the sender text body end to end (the /pair path)', () => {
    const msg: WeixinMessage = {
      message_id: 42,
      from_user_id: 'wxid_user',
      to_user_id: 'bot-id',
      create_time_ms: 1_700_000_000_000,
      message_type: 1, // USER
      item_list: [item({ type: MessageItemType.TEXT, text_item: { text: '/pair 123456' } })],
    }
    const ctx = weixinMessageToMsgContext(msg, 'bot-1')
    expect(ctx.Body).toBe('/pair 123456')
    expect(ctx.From).toBe('wxid_user')
  })

  it('does not surface legacy content-key text as a body', () => {
    const msg: WeixinMessage = {
      from_user_id: 'wxid_user',
      item_list: [item({ type: MessageItemType.TEXT, text_item: { content: '/pair 000000' } as never })],
    }
    expect(weixinMessageToMsgContext(msg, 'bot-1').Body).toBe('')
  })
})

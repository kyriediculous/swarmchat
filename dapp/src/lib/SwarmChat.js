// @flow

import createWebSocketRPC from '@mainframe/rpc-ws-browser'
import { decodeHex, encodeHex, type hex } from '@mainframe/utils-hex'
import PssAPI from 'erebos-api-pss'
import type { Observable } from 'rxjs'
import { map, filter } from 'rxjs/operators'

import { createEvent, type SwarmEvent } from './SwarmEvent'

export const PROTOCOL = 'swarmchat/v1'

// TODO: move to erebos-api-pss
export type PssEvent = {
  Key: hex,
  Asym: boolean,
  Msg: hex,
}

export type IncomingProtocolEvent = {
  key: hex,
  data: SwarmEvent,
}

export type ContactRequestPayload = {
  topic: hex,
  overlay_address?: hex,
  username?: string,
  message?: string,
}

export type IncomingContactRequest = {
  type: 'contact_request',
  key: hex,
  payload: ContactRequestPayload,
}

export type ContactResponsePayload = {
  contact: boolean,
  overlay_address?: hex,
  username?: string,
}

export type IncomingContactResponse = {
  type: 'contact_response',
  key: hex,
  payload: ContactResponsePayload,
}

export type IncomingContactEvent =
  | IncomingContactRequest
  | IncomingContactResponse

export type IncomingEvent = IncomingContactEvent

export type OwnInfo = {
  publicKey: hex,
  overlayAddress: hex,
}

const createRandomString = (): string => {
  return Math.random()
    .toString(36)
    .slice(2)
}

export const createPssMessage = (type: string, payload?: Object): hex => {
  return encodeHex(JSON.stringify(createEvent(PROTOCOL, type, payload)))
}

export const decodePssEvent = (data: PssEvent): IncomingProtocolEvent => ({
  key: data.Key,
  data: JSON.parse(decodeHex(data.Msg)),
})

export default class SwarmChat {
  _pss: PssAPI
  _ownInfo: ?OwnInfo

  constructor(url) {
    this._pss = new PssAPI(createWebSocketRPC(url))
  }

  get hasOwnInfo(): boolean {
    return this._ownInfo != null
  }

  async getOwnInfo(): Promise<OwnData> {
    if (!this.hasOwnInfo) {
      const [publicKey, overlayAddress] = await Promise.all([
        this._pss.getPublicKey(),
        this._pss.baseAddr(),
      ])
      this._ownInfo = { publicKey, overlayAddress }
    }
    return this._ownInfo
  }

  async createContactSubscription(): Promise<Observable<IncomingContactEvent>> {
    const { publicKey } = await this.getOwnInfo()
    const topic = await this._pss.stringToTopic(publicKey)
    const sub = await this._pss.createTopicSubscription(topic)
    return sub.pipe(
      map(decodePssEvent),
      filter((event: IncomingProtocolEvent) => {
        return (
          event.data.protocol === PROTOCOL &&
          ((event.data.type === 'contact_request' &&
            event.data.payload.topic != null) ||
            event.data.type === 'contact_response')
        )
      }),
      map(
        (event: IncomingProtocolEvent): IncomingContactEvent => ({
          key: event.key,
          type: event.data.type,
          payload: event.data.payload,
        }),
      ),
    )
  }

  async sendContactRequest(
    key: hex,
    data?: { username?: string, message?: string } = {},
  ): Promise<hex> {
    const [ownInfo, contactTopic, sharedTopic] = await Promise.all([
      this.getOwnInfo(),
      this._pss.stringToTopic(key),
      this._pss.stringToTopic(createRandomString()),
    ])
    await Promise.all([
      this._pss.setPeerPublicKey(key, contactTopic),
      this._pss.setPeerPublicKey(key, sharedTopic),
    ])
    const message = createPssMessage('contact_request', {
      ...data,
      topic: sharedTopic,
      overlay_address: ownInfo.overlayAddress,
    })
    await this._pss.sendAsym(key, contactTopic, message)
    return sharedTopic
  }

  async sendContactResponse(
    key: hex,
    accept: boolean,
    data?: { username?: string } = {},
  ): Promise<void> {
    const payload = { contact: accept }
    if (accept) {
      const ownInfo = await this.getOwnInfo()
      payload.overlay_address = ownInfo.overlayAddress
      if (data.username != null) {
        payload.username = data.username
      }
    }
    const topic = await this._pss.stringToTopic(key)
    await this._pss.setPeerPublicKey(key, topic)
    const message = createPssMessage('contact_response', payload)
    await this._pss.sendAsym(key, topic, message)
  }
}

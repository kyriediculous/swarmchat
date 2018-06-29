// @flow

import type { hex } from '@mainframe/utils-hex'
import React, { Component } from 'react'
import Modal from 'react-modal'
import { Button, StyleSheet, Text, View } from 'react-native-web'
import type { Subscription } from 'rxjs'

import { getAppData, setAppData } from '../store'
import type { Contacts } from '../types'

import type {
  default as SwarmChat,
  IncomingContactEvent,
} from '../lib/SwarmChat'

import Avatar from './Avatar'
import ContactsList from './ContactsList'
import FormError from './FormError'
import FormInput from './FormInput'
import Loader from './Loader'
import sharedStyles, { COLORS } from './styles'

const PUBLIC_KEY_RE = /^0x[0-9a-f]{130}$/

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
  },
  sidebar: {
    width: 200,
    flexDirection: 'column',
    backgroundColor: COLORS.BACKGROUND_CONTRAST,
  },
  sidebarHeader: {
    padding: 5,
    flexDirection: 'row',
  },
  sidebarHeaderText: {
    fontSize: 18,
    lineHeight: 48,
    color: COLORS.TEXT_CONTRAST,
    textAlign: 'center',
  },
  content: {
    flex: 1,
    flexDirection: 'column',
  },
})

type State = {
  contactKey: string,
  contacts: Contacts,
  inviteErrorMessage?: ?string,
  inviteModalOpen: boolean,
  publickKey?: hex,
  selectedKey?: hex,
  username: string,
}

export default class App extends Component<{ client: SwarmChat }, State> {
  _sub: ?Subscription

  state = {
    contactKey: '',
    contacts: {},
    inviteModalOpen: false,
    username: '',
  }

  async setup() {
    const { client } = this.props
    const { publicKey } = await client.getOwnInfo()
    const [appData, contactsSub] = await Promise.all([
      getAppData(publicKey),
      client.createContactSubscription(),
    ])
    this.setState({ ...appData, publicKey }, () => {
      this._sub = contactsSub.subscribe(this.onReceiveContactEvent)
    })
  }

  componentDidMount() {
    this.setup()
  }

  componentWillUnmount() {
    if (this._sub != null) {
      this._sub.unsubscribe()
    }
  }

  onReceiveContactEvent = (ev: IncomingContactEvent) => {
    console.log('received contact event', ev)
    this.setState(({ contacts }) => {
      const existing = contacts[ev.key]
      if (
        ev.type === 'contact_request' &&
        (existing == null || existing.state === 'received_pending')
      ) {
        // New contact or update existing with new payload
        return {
          contacts: {
            ...contacts,
            [ev.key]: {
              key: ev.key,
              type: 'received_pending',
              topic: ev.payload.topic,
              username: ev.payload.username,
            },
          },
        }
      } else if (
        ev.type === 'contact_response' &&
        existing != null &&
        (existing.state === 'sent_declined' ||
          existing.state === 'sent_pending')
      ) {
        // Response from contact, set type to "added" or "sent_declined" accordingly
        return {
          contacts: {
            ...contacts,
            [ev.key]: {
              ...existing,
              type: ev.payload.contact === true ? 'added' : 'sent_declined',
              username: ev.payload.username,
            },
          },
        }
      }
      return null
    })
  }

  onChangeContactKey = (value: string) => {
    this.setState({ contactKey: value })
  }

  onChangeUsername = (value: string) => {
    this.setState({ username: value })
  }

  onSubmitContact = async () => {
    const { contactKey, publicKey, username } = this.state
    if (contactKey.length === 0) {
      return
    }

    if (contactKey === publicKey) {
      this.setState({
        inviteErrorMessage: 'Invalid contact key: this is your own key',
      })
    } else if (!PUBLIC_KEY_RE.test(contactKey)) {
      this.setState({
        inviteErrorMessage:
          'Invalid contact key: must be an hexadecimal string prefixed with "0x"',
      })
    } else {
      this.setState({ inviteModalOpen: false })
      const data = username.length > 0 ? { username } : undefined
      const topic = await this.props.client.sendContactRequest(contactKey, data)
      this.setState(({ contacts }) => ({
        contactKey: '',
        contacts: {
          ...contacts,
          [contactKey]: {
            key: contactKey,
            type: 'sent_pending',
            topic,
          },
        },
      }))
    }
  }

  onOpenInviteModal = () => {
    this.setState({ inviteModalOpen: true })
  }

  onCloseInviteModal = () => {
    this.setState({ inviteModalOpen: false })
  }

  onSelectKey = (selectedKey: hex) => {
    this.setState({ selectedKey })
  }

  render() {
    const {
      contactKey,
      contacts,
      inviteErrorMessage,
      inviteModalOpen,
      publicKey,
      selectedKey,
      username,
    } = this.state

    if (publicKey == null) {
      return <Loader />
    }

    return (
      <View style={styles.root}>
        <View style={styles.sidebar}>
          <View style={styles.sidebarHeader}>
            <Avatar publicKey={publicKey} size="large" />
            <Text numberOfLines={1} style={styles.sidebarHeaderText}>
              &nbsp;{username || publicKey}
            </Text>
          </View>
          <ContactsList
            contacts={contacts}
            onOpenInviteModal={this.onOpenInviteModal}
            onSelectKey={this.onSelectKey}
            selectedKey={selectedKey}
          />
        </View>
        <View style={styles.content}>
          <Text>Hello {publicKey}</Text>
        </View>
        <Modal
          isOpen={inviteModalOpen}
          onRequestClose={this.onCloseInviteModal}>
          <FormError message={inviteErrorMessage} />
          <View>
            <Text>Contact key:</Text>
            <FormInput
              onChangeText={this.onChangeContactKey}
              onSubmitEditing={this.onSubmitContact}
              value={contactKey}
            />
          </View>
          <View>
            <Text>Your username (optional):</Text>
            <FormInput
              onChangeText={this.onChangeUsername}
              onSubmitEditing={this.onSubmitContact}
              value={username}
            />
          </View>
          <Button
            color={COLORS.BUTTON_PRIMARY}
            disabled={contactKey.length === 0}
            onPress={this.onSubmitContact}
            title="Invite contact"
          />
        </Modal>
      </View>
    )
  }
}
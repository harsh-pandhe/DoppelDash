declare module 'imapflow' {
  interface ImapFlowOptions {
    host: string
    port: number
    secure: boolean
    auth: { user: string; pass: string }
    logger?: boolean | object
  }

  interface MailboxLock {
    release(): void
  }

  interface MessageEnvelope {
    subject?: string
    date?: Date
    from?: Array<{ name?: string; address?: string }>
  }

  interface FetchedMessage {
    uid: number
    envelope?: MessageEnvelope
    bodyParts?: Map<string, Buffer>
  }

  export class ImapFlow {
    constructor(opts: ImapFlowOptions)
    connect(): Promise<void>
    logout(): Promise<void>
    getMailboxLock(path: string): Promise<MailboxLock>
    search(criteria: Record<string, unknown>): Promise<number[]>
    fetch(
      range: number[] | string,
      query: Record<string, unknown>
    ): AsyncIterable<FetchedMessage>
  }
}

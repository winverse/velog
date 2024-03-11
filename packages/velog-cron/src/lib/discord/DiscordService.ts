import { injectable, singleton } from 'tsyringe'
import { Client, GatewayIntentBits } from 'discord.js'
import { ENV } from '@env'

@injectable()
@singleton()
export class DiscordService {
  private client!: Client
  public isSending: boolean = false
  construct() {}
  public connection(): Promise<Client> {
    return new Promise((resolve) => {
      this.client = new Client({
        intents: [GatewayIntentBits.MessageContent],
      })

      this.client.on('ready', () => {
        console.log('Discord Client ready')
        resolve(this.client)
      })

      this.client.login(ENV.discordBotToken)
    })
  }
  public async sendMessage(type: MessageType, message: string) {
    this.isSending = true

    const frequentWord = ['connection pool', 'canceling statement', 'Not allow origin']
    const isFrequentWordIncluded = frequentWord.some((word) => message.includes(word))

    if (isFrequentWordIncluded) {
      this.isSending = false
      console.log('Frequent word included skip sending message')
      return
    }

    try {
      const isReady = this.client.isReady()

      if (!isReady) {
        throw new Error('Discord bot is not ready')
      }

      const channelMapper: Record<MessageType, string> = {
        stats: ENV.discordStatsChannel,
      }

      const channelId = channelMapper[type]

      if (!channelId) {
        throw new Error('Not found discord channel id')
      }

      const channel = await this.client.channels.fetch(channelId)

      if (channel?.isTextBased()) {
        if (message.length > 2000) {
          console.log('message', message)
        }
        await channel.send(message.slice(0, 2000))
      } else {
        throw new Error('Wrong channel type')
      }
    } catch (error: any) {
      console.log(error)
      throw new Error('Failed to send meesage to discord channel')
    } finally {
      this.isSending = false
    }
  }
}

type MessageType = 'stats'

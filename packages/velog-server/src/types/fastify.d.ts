import { CurrentUser } from '@common/interfaces/user'
import { SocialProfile } from '@services/SocialService/SocialServiceInterface'
import 'fastify'

declare module 'fastify' {
  interface FastifyRequest {
    user: CurrentUser | null
    ipaddr: string | null
    socialProfile: SocialProfile | null
  }
}

import { Time } from '@constants/TimeConstants.js'
import { ENV } from '@env'
import { B2ManagerService } from '@lib/b2Manager/B2ManagerService.js'
import { CookieService } from '@lib/cookie/CookieService.js'
import { DbService } from '@lib/db/DbService.js'
import { FileService } from '@lib/file/FileService.js'
import { JwtService } from '@lib/jwt/JwtService.js'
import { User, UserProfile } from '@prisma/client'
import {
  GetProfileFromSocial,
  SocialProvider,
} from '@services/SocialService/SocialServiceInterface.js'
import { SocialService } from '@services/SocialService/index.js'
import { ExternalIntegrationService } from '@services/ExternalIntegrationService/index.js'
import { FastifyReply, FastifyRequest } from 'fastify'
import { injectable, singleton } from 'tsyringe'
import { google } from 'googleapis'
import { UnauthorizedError } from '@errors/UnauthorizedError.js'
import { ConfilctError } from '@errors/ConfilctError.js'
import { BadRequestError } from '@errors/BadRequestErrors.js'
import { NotFoundError } from '@errors/NotfoundError.js'

interface Controller {
  facebookCallback(
    request: FastifyRequest<{ Querystring: { code: string } }>,
    reply: FastifyReply,
  ): Promise<void>
  githubCallback(
    request: FastifyRequest<{ Querystring: { code: string } }>,
    reply: FastifyReply,
  ): Promise<void>
  socialCallback(
    request: FastifyRequest<{ Querystring: { state?: string; next?: string } }>,
    reply: FastifyReply,
  ): Promise<void>
  socialRegister(
    request: FastifyRequest<{
      Body: { display_name: string; username: string; short_bio: string }
    }>,
    reply: FastifyReply,
  ): Promise<SocialRegisterResult>
  getSocialProfile(request: FastifyRequest, reply: FastifyReply): Promise<GetProfileFromSocial>
}

@singleton()
@injectable()
export class SocialController implements Controller {
  constructor(
    private readonly socialService: SocialService,
    private readonly db: DbService,
    private readonly jwt: JwtService,
    private readonly cookie: CookieService,
    private readonly file: FileService,
    private readonly b2Manager: B2ManagerService,
    private readonly externalInterationService: ExternalIntegrationService,
  ) {}
  private get redirectUri(): string {
    return `${ENV.apiHost}/api/v2/auth/social/callback`
  }
  public async facebookCallback(
    request: FastifyRequest<{ Querystring: { code: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { code } = request.query

    if (!code) {
      throw new BadRequestError('Code is required')
    }

    const profile = await this.socialService.getSocialDataFromFacebook(code)
    request.socialProfile = profile
  }
  public async githubCallback(
    request: FastifyRequest<{ Querystring: { code: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { code } = request.query

    if (!code) {
      throw new BadRequestError('Code is required')
    }

    const profile = await this.socialService.getSocialDataFromGithub(code)
    request.socialProfile = profile
  }
  public async googleCallback(
    request: FastifyRequest<{ Querystring: { code: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { code } = request.query

    if (!code) {
      throw new BadRequestError('Code is required')
    }

    const profile = await this.socialService.getSocialDataFromGoogle(code)
    request.socialProfile = profile
  }
  public async socialCallback(
    request: FastifyRequest<{ Querystring: { state?: string; next?: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    if (!request.socialProfile) {
      throw new NotFoundError('Social profile data is missing')
    }

    const { profile, socialAccount, accessToken, provider } = request.socialProfile

    if (!profile) {
      throw new NotFoundError('Not found social profile')
    }

    if (!accessToken) {
      throw new NotFoundError('Not found social access token')
    }

    if (socialAccount) {
      const user = await this.db.user.findUnique({
        where: {
          id: socialAccount.fk_user_id!,
        },
      })

      if (!user) {
        throw new Error('User is missing')
      }

      const tokens = await this.jwt.generateUserToken(user.id)
      this.cookie.setCookie(reply, 'access_token', tokens.accessToken, {
        maxAge: Time.ONE_HOUR_IN_MS,
      })
      this.cookie.setCookie(reply, 'refresh_token', tokens.refreshToken, {
        maxAge: Time.ONE_DAY_IN_MS * 30,
      })

      const redirectUrl = ENV.clientHost
      const state = request.query.state
        ? (JSON.parse(request.query.state) as { next: string; integrateState?: string })
        : null
      const next = request.query.next || state?.next || '/'

      if (next.includes('user-integrate') && state) {
        const isIntegrated = await this.externalInterationService.checkIntegrated(user.id)
        if (isIntegrated) {
          const code = await this.externalInterationService.createIntegrationCode(user.id)
          reply.redirect(`${ENV.codenaryCallback}?code=${code}&state=${state.integrateState}`)
          return
        }
      }

      reply.redirect(decodeURI(redirectUrl.concat(next)))
    }
  }
  public async socialRegister(
    request: FastifyRequest<{
      Body: { display_name: string; username: string; short_bio: string }
    }>,
    reply: FastifyReply,
  ): Promise<SocialRegisterResult> {
    // check token existancy
    const registerToken = this.cookie.getCookie(reply, 'register_token')
    if (!registerToken) {
      throw new UnauthorizedError()
    }

    const { display_name, username, short_bio } = request.body
    let decoded: SocialRegisterToken | null = null
    try {
      decoded = await this.jwt.decodeToken<SocialRegisterToken>(registerToken)
    } catch (e) {
      throw new UnauthorizedError()
    }

    const email = decoded.profile.email

    const exists = await this.db.user.findFirst({
      where: {
        OR: [
          { username: username },
          {
            email: {
              equals: email,
              not: null,
            },
          },
        ],
      },
    })

    if (exists) {
      throw new ConfilctError('ALREADY_EXISTS')
    }

    const user = await this.db.user.create({
      data: {
        username,
        email,
        is_certified: true,
        profile: {
          create: {
            display_name,
            short_bio,
          },
        },
        socialAccount: {
          create: {
            access_token: decoded.accessToken,
            provider: decoded.provider,
            social_id: decoded.profile.uid.toString(),
          },
        },
        velogConfig: {
          create: {},
        },
        userMeta: {
          create: {},
        },
      },
    })

    if (decoded?.profile.thumbnail) {
      const imageUrl = await this.syncProfileImageWithB2(decoded.profile.thumbnail, user)

      await this.db.userProfile.update({
        where: {
          fk_user_id: user.id,
        },
        data: {
          thumbnail: imageUrl,
        },
      })
    }

    const tokens = await this.jwt.generateUserToken(user.id)
    this.cookie.setCookie(reply, 'access_token', tokens.accessToken, {
      maxAge: Time.ONE_HOUR_IN_MS,
    })
    this.cookie.setCookie(reply, 'refresh_token', tokens.refreshToken, {
      maxAge: Time.ONE_DAY_IN_MS * 30,
    })

    const profile = await this.db.userProfile.findFirst({
      where: {
        fk_user_id: user.id,
      },
    })

    const result = {
      ...user,
      profile: profile!,
      tokens: {
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
      },
    }

    return result
  }
  private async syncProfileImageWithB2(url: string, user: User): Promise<string> {
    const result = await this.file.downloadFile(url)

    const filename = `social_profile.${result.extension}`

    //convert readstream to buffer
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const buffers: Buffer[] = []
      result.stream.on('data', (data: Buffer) => buffers.push(data))
      result.stream.on('end', () => resolve(Buffer.concat(buffers)))
      result.stream.on('error', reject)
    })

    const filesize = buffer.length
    const userImage = await this.db.userImage.create({
      data: {
        fk_user_id: user.id,
        type: 'profile',
        filesize,
      },
    })

    const uploadPath = this.file
      .generateUploadPath({
        id: userImage.id,
        type: 'profile',
        username: user.username,
      })
      .concat(`/${filename}`)

    const uploadResult = await this.b2Manager.upload(buffer, uploadPath)

    return uploadResult.url
  }
  public async getSocialProfile(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<GetProfileFromSocial> {
    const registerToken = this.cookie.getCookie(reply, 'register_token')
    if (!registerToken) {
      throw new UnauthorizedError()
    }

    try {
      const decoded = await this.jwt.decodeToken<SocialRegisterToken>(registerToken)

      return decoded.profile
    } catch (e) {
      throw new BadRequestError()
    }
  }
  public async socialRedirect(
    request: FastifyRequest<{
      Params: { provider: SocialProvider }
      Querystring: { next: string; isIntegrate: string; integrateState: string }
    }>,
    reply: FastifyReply,
  ) {
    const { next, isIntegrate, integrateState } = request.query
    const { provider } = request.params
    const loginUrl = this.generateSocialLoginLink(provider, {
      isIntegrate: isIntegrate === '1',
      next,
      integrateState,
    })
    reply.redirect(loginUrl)
  }
  private generateSocialLoginLink(
    provider: SocialProvider,
    { next = '/', isIntegrate = false, integrateState }: Options,
  ) {
    const generator = this.socialLoginLiknGenerator[provider]
    return generator({
      next: encodeURI(next),
      isIntegrate,
      integrateState,
    })
  }
  private get socialLoginLiknGenerator() {
    return {
      github: ({ next, isIntegrate, integrateState }: Options) => {
        const redirectUriWithOptions = `${this.redirectUri}/github?next=${next}&isIntegrate=${
          isIntegrate ? 1 : 0
        }&integrateState=${integrateState ?? ''}`
        return `https://github.com/login/oauth/authorize?scope=user:email&client_id=${ENV.githubClientId}&redirect_uri=${redirectUriWithOptions}`
      },
      facebook: ({ next, isIntegrate, integrateState }: Options) => {
        const state = JSON.stringify({ next, isIntegrate: isIntegrate ? 1 : 0, integrateState })
        const callbackUri = `${this.redirectUri}/facebook`
        return `https://www.facebook.com/v4.0/dialog/oauth?client_id=${ENV.facebookClientId}&redirect_uri=${callbackUri}&state=${state}&scope=email,public_profile`
      },
      google: ({ next, isIntegrate, integrateState }: Options) => {
        const callback = `${this.redirectUri}/google`
        const oauth2Client = new google.auth.OAuth2(ENV.googleClientId, ENV.googleSecret, callback)
        const url = oauth2Client.generateAuthUrl({
          scope: [
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
          ],
          state: JSON.stringify({ next, isIntegrate: isIntegrate ? 1 : 0, integrateState }),
        })
        return url
      },
    }
  }
}

type SocialRegisterToken = {
  profile: GetProfileFromSocial
  provider: SocialProvider
  accessToken: string
}

type SocialRegisterResult = {
  profile: UserProfile
  tokens: {
    access_token: string
    refresh_token: string
  }
} & User

type Options = {
  next: string
  isIntegrate?: boolean
  integrateState?: string
}

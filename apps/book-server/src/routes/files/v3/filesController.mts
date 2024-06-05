import { injectable, singleton } from 'tsyringe'
import { UploadBody } from './schema.mjs'
import { UnauthorizedError } from '@errors/UnauthorizedError.mjs'
import { FileService } from '@lib/file/FileService.mjs'
import { File } from 'fastify-multer/lib/interfaces.js'
import { BadRequestError } from '@errors/BadRequestErrors.mjs'
import { HttpError } from '@errors/HttpError.mjs'
import { ForbiddenError } from '@errors/ForbiddenError.mjs'
import { InternalServerError } from '@errors/InternalServerError.mjs'
import { WriterService } from '@services/WriterService/index.mjs'
import { BookService } from '@services/BookService/index.mjs'
import { ImageService } from '@services/ImageService/index.mjs'
import { MongoService } from '@lib/mongo/MongoService.mjs'
import { R2Service } from '@lib/cloudflare/R2/R2Service.mjs'

interface Controller {
  upload({ body, file, signedWriterId }: UploadArgs): Promise<UploadResult>
}

@singleton()
@injectable()
export class FilesController implements Controller {
  constructor(
    private readonly file: FileService,
    private readonly mongo: MongoService,
    private readonly r2: R2Service,
    private readonly writerService: WriterService,
    private readonly bookService: BookService,
    private readonly imageService: ImageService,
  ) {}
  public async upload({ body, file, signedWriterId }: UploadArgs): Promise<UploadResult> {
    console.log('hello', this.r2.getBuckets())

    if (!signedWriterId) {
      throw new UnauthorizedError('Not logged in')
    }

    if (!file) {
      throw new BadRequestError('Not found file')
    }

    const { ref_id, bookUrlSlug, type } = body

    if (!['book'].includes(type)) {
      throw new BadRequestError('Invalid type')
    }

    const user = await this.writerService.findById(signedWriterId)

    if (!user) {
      throw new UnauthorizedError('Invalid User')
    }

    const isAbuse = await this.imageService.detectAbuse(signedWriterId)

    if (isAbuse) {
      throw new HttpError('Too many requests', 'is abused user', 429)
    }

    if (type === 'book' && !!ref_id) {
      const book = await this.bookService.findByUrlSlug(bookUrlSlug)
      if (book?.fk_writer_id !== signedWriterId) {
        throw new ForbiddenError("Can't access the post")
      }
    }

    const originalFileName = file.originalname
    const extension = originalFileName.split('.').pop()
    const filename = `image.${extension}`

    const image = await this.mongo.image.create({
      data: {
        fk_writer_id: signedWriterId,
        filesize: file.size || 0,
        type,
        ref_id: ref_id ?? null,
      },
    })

    const filepath = this.file
      .generateUploadPath({
        type: type,
        id: image.id,
        username: user.username,
      })
      .concat(`/${encodeURIComponent(decodeURI(filename))}`)

    try {
      // TODO: upload file to R2
      const result: string = ''
      await this.mongo.image.update({
        where: {
          id: image.id,
        },
        data: {
          path: filepath,
        },
      })

      return {
        path: filepath,
      }
    } catch (error) {
      console.log('Upload file error', error)
      throw new InternalServerError()
    }
  }
}

type UploadArgs = {
  body: UploadBody
  file?: File
  signedWriterId?: string
}

type UploadResult = {
  path: string
}

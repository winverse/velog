import { Image } from '@pulumi/awsx/ecr'

export type PackageType = 'web' | 'server' | 'cron'

export type CreateInfraParameter = {
  vpcId: Promise<string>
  subnetIds: Promise<string[]>
  certificateArn: Promise<string>
  defaultSecurityGroupId: Promise<string>
  imageUri: string
}

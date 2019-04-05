import { AWS } from './aws'
import fs from 'fs'
import { MasterConfig } from './config'
import chalk from 'chalk'
import { MasterValidator } from './validator/master'
import defaultConfigJson from './config/default.json'
import loadJsonFile from 'load-json-file'

export class XyGithubScan {

  private config = new MasterConfig("master")
  private validator = new MasterValidator(new MasterConfig("master"))
  private preflight?: string
  private aws = new AWS()

  public async loadConfig(filename?: string) {
    try {
      const filenameToLoad = filename || './githublint.json'
      /*const ajv = new Ajv({ schemaId: 'id' })
      const validate = ajv.compile(schema)
      if (!validate(defaultConfig)) {
        console.error(chalk.red(`${validate.errors}`))
      } else {
        console.log(chalk.green("Default Config Validated"))
      }*/
      const defaultConfig = MasterConfig.parse(defaultConfigJson)
      console.log(chalk.gray("Loaded Default Config"))
      try {
        const userConfigJson = await loadJsonFile(filenameToLoad)
        const userConfig = MasterConfig.parse(userConfigJson)
        /*if (!validate(userJson)) {
          console.error(chalk.red(`${validate.errors}`))
        } else {
          console.log(chalk.green("User Config Validated"))
        }*/
        console.log(chalk.gray("Loaded User Config"))
        const result = defaultConfig.merge(userConfig)
        return result
      } catch (ex) {
        console.log(chalk.yellow(`No githublint.json config file found.  Using defaults: ${ex.message}`))
        console.error(ex.stack)
        return defaultConfig
      }
    } catch (ex) {
      console.log(chalk.red(`Failed to load defaults: ${ex}`))
      console.error(ex.stack)
      return new MasterConfig("master")
    }
  }

  public async start(
    params: {
      output: string,
      singleRepo?: {owner: string, name: string, branch: "master"},
      bucket?: string,
      config?: MasterConfig,
      preflight?: string
    }
  ) {
    this.config = await this.loadConfig()
    this.preflight = params.preflight

    // if repository specified, clear configed repositorys and add it
    if (params.singleRepo) {
      console.log(chalk.yellow(`Configuring Single Repository: ${params.singleRepo.owner}/${params.singleRepo.name}`))
      const singleRepoConfig = this.config.getRepositoryConfig(params.singleRepo)
      this.config.repositories.set(
        singleRepoConfig.key,
        singleRepoConfig
      )

      // since we are doing just one, disable github list get
      this.config.github.enabled = false

      // since we are only doing one, remove the rest
      for (const repository of this.config.repositories.values()) {
        if (repository.name !== "*" &&
            (repository.name !== params.singleRepo.name || repository.owner !== params.singleRepo.owner)
        ) {
          this.config.repositories.delete(repository.key)
        }
      }
    }

    if (this.preflight) {
      if (typeof this.preflight !== 'string') {
        this.preflight = 'githublint_preflight.json'
      }
      await this.saveToFile(this.preflight, this.config)
    }

    this.validator = new MasterValidator(this.config)

    await this.validator.validate()

    if (params.bucket) {
      this.saveToAws(params.bucket)
    }

    console.log(`Saving to File: ${params.output}`)
    this.saveToFile(params.output, this.validator)
    if (this.validator.errorCount === 0) {
      console.log(chalk.green("Congratulations, all tests passed!"))
    } else {
      console.error(chalk.yellow(`Total Errors Found: ${this.validator.errorCount}`))
    }
    return this.validator
  }

  private getLatestS3FileName() {
    return `latest.json`
  }

  private getHistoricS3FileName() {
    const date = new Date().toISOString()
    const parts = date.split('T')
    return `${parts[0]}/${parts[1]}.json`
  }

  private async saveToAws(bucket: string) {
    try {
      await this.aws.saveFileToS3(bucket, this.getLatestS3FileName(), this.validator)
      await this.aws.saveFileToS3(bucket, this.getHistoricS3FileName(), this.validator)
    } catch (ex) {
      console.error(chalk.red(ex.message))
      console.error(chalk.red(ex.stack))
    }
  }

  private async saveToFile(filename: string, obj: any) {
    fs.open(filename, 'w', (err, fd) => {
      if (err) {
        console.log(`failed to open file: ${err}`)
      } else {
        fs.write(fd, JSON.stringify(obj), (errWrite) => {
          if (errWrite) {
            console.log(`failed to write file: ${errWrite}`)
          }
        })
      }
    })
  }
}

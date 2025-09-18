import * as path from "path";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";

import { ormConfig } from "../common/orm.config";

const rootPath = path.resolve(process.cwd());

// Toggle DB usage via env (dev default: no DB)
const USE_DB = (process.env.USE_DB ?? "true").toLowerCase() !== "false";

const importsArr: any[] = [
  ConfigModule.forRoot({
    isGlobal: true,
    envFilePath: [path.resolve(rootPath, `.env.${process.env.NODE_ENV}`)],
  }),
];

if (USE_DB) {
  importsArr.push(
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ormConfig(configService),
    })
  );
}

@Module({
  imports: importsArr,
  controllers: [],
  providers: [],
})
export class AppModule {}

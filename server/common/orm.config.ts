import {ConfigService} from "@nestjs/config";
import {TypeOrmModuleOptions} from "@nestjs/typeorm";

export const ormConfig = async (
	configService: ConfigService
): Promise<TypeOrmModuleOptions> => {
	const nodeEnv = configService.get<string>("NODE_ENV");

	return {
		type: "mariadb",
		host: configService.get<string>("DB_HOST"),
		port: configService.get<number>("DB_PORT"),
		database: configService.get<string>("DB_NAME"),
		username: configService.get<string>("DB_USER"),
		password: configService.get<string>("DB_PASSWORD"),
		entities: [__dirname + "/../**/*.entity.{js,ts}"],
		logging: false,
		synchronize: true,
		autoLoadEntities: true,
	};
};

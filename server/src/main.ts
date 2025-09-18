import "reflect-metadata";
import {ValidationPipe} from "@nestjs/common";
import {NestFactory} from "@nestjs/core";
import {ConfigService} from "@nestjs/config";
import {AppModule} from "./app.module";

async function bootstrap() {
	const app = await NestFactory.create(AppModule);

	const config = app.get(ConfigService);
	const nodeEnv = config.get<string>("NODE_ENV") || "development";
	const clientUrl =
		config.get<string>("CLIENT_URL") || "http://localhost:3333";

	app.enableCors({
		origin: nodeEnv === "production" ? [clientUrl] : true,
		credentials: true,
		methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
		allowedHeaders: "Content-Type, Authorization",
		exposedHeaders: ["Authorization"],
	});

	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			forbidNonWhitelisted: false,
			transform: true,
			transformOptions: {enableImplicitConversion: true},
		})
	);

	const port = Number(config.get<string>("PORT")) || 5555;
	await app.listen(port);
	const url = await app.getUrl();
	console.log(`Server running (${nodeEnv}) at: ${url}`);
}

bootstrap();

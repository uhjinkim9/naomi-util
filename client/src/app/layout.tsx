import type {Metadata} from "next";

export const metadata: Metadata = {
	title: "UCUBERS",
	description: "THE UCUBE GROUPWARE",
	icons: {
		icon: "/favicon.ico",
	},
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="ko">
			<body>{children}</body>
		</html>
	);
}

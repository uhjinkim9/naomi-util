import type {Metadata} from "next";

export const metadata: Metadata = {
	title: "NAOMI UTIL",
	description: "Entity Converter",
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

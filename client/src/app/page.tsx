"use client";
import styles from "./page.module.scss";
import {useRouter} from "next/navigation";

export default function RootPage() {
	const router = useRouter();

	return (
		<div className={styles.root}>
			<button onClick={() => router.push("/entity-to-dto")}>Entity to DTO Converter</button>
			<button onClick={() => router.push("/entity-to-type")}>Entity to Type Converter</button>
		</div>
	)
}

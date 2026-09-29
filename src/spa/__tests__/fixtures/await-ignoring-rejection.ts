export async function awaitIgnoringRejection(
	promise: Promise<unknown>,
): Promise<void> {
	try {
		await promise;
	} catch {}
}

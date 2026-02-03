export const getError = (errCode: string): string => {
	const code = errCode.split('auth/')[1]

	if (code === 'invalid-credential') {
		return `User doesn't exist / wrong password`
	}

	if (code === 'weak-password') {
		return 'Password should be at least 6 characters'
	}

	const formattedCode = code.split('-').map(
		word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
	).join(' ')

    return formattedCode
}
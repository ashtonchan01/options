import { forgotPasswordHandler } from '../_lib/passwordReset.js'

export default function handler(req, res) {
  return forgotPasswordHandler(req, res)
}

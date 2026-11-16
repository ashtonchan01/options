import { resetPasswordHandler } from '../_lib/passwordReset.js'

export default function handler(req, res) {
  return resetPasswordHandler(req, res)
}
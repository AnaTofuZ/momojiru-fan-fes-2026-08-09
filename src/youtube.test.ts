import assert from 'node:assert/strict'
import { clock, youtubeSeconds } from './youtube.ts'

assert.equal(youtubeSeconds('https://youtu.be/example?t=3821'), 3821)
assert.equal(youtubeSeconds('https://youtube.com/watch?v=example&t=1h3m41s'), 3821)
assert.equal(youtubeSeconds('not a url'), null)
assert.equal(clock(3821), '1:03:41')
console.log('youtube timestamp checks passed')

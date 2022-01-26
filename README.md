# serial-async-io

stat(), read(), and write() files via fs/promises, but one at a time.

Install `yarn add serial-async-io`

Import `import { read, write } from 'serial-async-io'`

Or `import io from 'serial-async-io'`

All three return promises.

Also, `stat()` returns false upon failure instead of throwing

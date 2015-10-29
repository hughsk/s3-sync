# s3-sync #

A streaming upload tool for Amazon S3, taking input from a
[`readdirp`](http://npmjs.org/package/readdirp) stream, and outputting the
resulting files.

s3-sync is also optionally backed by a [level](http://github.com/level/level)
database to use as a local cache for file uploads. This way, you can minimize
the frequency you have to hit S3 and speed up the whole process considerably.

You can use this to sync complete directory trees with S3 when deploying static
websites. It's a work in progress, so expect occasional API changes and
additional features.

## Installation ##

``` bash
npm install s3-sync
```

## Usage ##

### `require('s3-sync').createStream([db, ]options)` ###

Creates an upload stream. Passes its options to [knox](http://ghub.io/knox),
so at a minimum you'll need:

* `key`: Your AWS access key.
* `secret`: Your AWS secret.
* `bucket`: The bucket to upload to.

The following are also specific to s3-sync:

* `concurrency`: The maximum amount of files to upload concurrently.
* `retries`: The maximum number of times to retry uploading a file before failing. By default the value is 7.
* `headers`: Additional headers to include on each file.
* `hashKey`: By default, file hashes are stored based on the file's absolute
  path. This doesn't work very nicely with temporary files, so you can pass
  this function in to map the file object to a string key for the hash.
* `acl`: Use a custom [ACL header](http://docs.aws.amazon.com/AmazonS3/latest/dev/acl-overview.html). Defaults to `public-read`.
* `force`: Force s3-sync to overwrite any existing files.

You can also store your local cache in S3, provided you pass the following
options, and use `getCache` and `putCache` (see below) before/after uploading:

* `cacheDest`: the path to upload your cache backup to in S3.
* `cacheSrc`: the local, temporary, text file to stream to before uploading to
  S3.

If you want more control over the files and their locations that you're
uploading, you can write file objects directly to the stream, e.g.:

``` javascript
var stream = s3sync({
    key: process.env.AWS_ACCESS_KEY
  , secret: process.env.AWS_SECRET_KEY
  , bucket: 'sync-testing'
})

stream.write({
    src: __filename
  , dest: '/uploader.js'
})

stream.end({
    src: __dirname + '/README.md'
  , dest: '/README.md'
})
```

Where `src` is the *absolute* local file path, and `dest` is the location to
upload the file to on the S3 bucket.

`db` is an optional argument - pass it a *level* database and it'll keep a
local cache of file hashes, keeping S3 requests to a minimum.

### `stream.putCache(callback)` ###

Uploads your level cache, if available, to the S3 bucket. This means that your
cache only needs to be populated once.

### `stream.getCache(callback)` ###

Streams a previously uploaded cache from S3 to your local level database.

### `stream.on('fail', callback)` ###

Emitted when a file has failed to upload. This will be called each time the
file is attempted to be uploaded.

## Example ##

Here's an example using `level` and `readdirp` to upload a local directory to
an S3 bucket:

``` javascript
var level = require('level')
  , s3sync = require('s3-sync')
  , readdirp = require('readdirp')

// To cache the S3 HEAD results and speed up the
// upload process. Usage is optional.
var db = level(__dirname + '/cache')

var files = readdirp({
    root: __dirname
  , directoryFilter: ['!.git', '!cache']
})

// Takes the same options arguments as `knox`,
// plus some additional options listed above
var uploader = s3sync(db, {
    key: process.env.AWS_ACCESS_KEY
  , secret: process.env.AWS_SECRET_KEY
  , bucket: 'sync-testing'
  , concurrency: 16
  , prefix : 'mysubfolder/' //optional prefix to files on S3
}).on('data', function(file) {
  console.log(file.fullPath + ' -> ' + file.url)
})

files.pipe(uploader)
```

You can find another example which includes remote cache storage at
[example.js](https://github.com/hughsk/s3-sync/blob/master/example.js).

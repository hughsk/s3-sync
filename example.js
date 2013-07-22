var db = require('level')('.cache')
var readdirp = require('readdirp')
var s3sync = require('./')

// To be updated with your own configuration
var syncer = s3sync(db, {
    key: process.env.AWS_ACCESS_KEY
  , secret: process.env.AWS_SECRET_KEY
  , bucket: process.env.AWS_BUCKET
})

console.error('cache downloading...')
syncer.getCache(function(err) {
  if (err) throw err

  // It's important that this stream
  // gets created in the same tick you
  // pipe it to syncer.
  var files = readdirp({
    root: __dirname + '/node_modules'
  })

  console.error('cache downloaded!')
  files.pipe(syncer)
    .on('data', function(d) {
      console.log(d.fullPath + ' -> ' + d.url)
    })
    .once('end', function() {
      console.error('uploading new cache')
      syncer.putCache(function(err) {
        if (err) throw err
        console.error('done!')
        db.close()
      })
    })
})

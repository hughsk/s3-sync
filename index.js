var createQueue = require('queue-async')
  , backoff = require('backoff')
  , es = require('event-stream')
  , crypto = require('crypto')
  , xtend = require('xtend')
  , mime = require('mime')
  , once = require('once')
  , knox = require('knox')
  , url = require('url')
  , fs = require('fs')

module.exports = s3syncer

function s3syncer(db, options) {
  if (!options) {
    options = db || {}
    db = false
  }

  options.concurrency = options.concurrency || 16
  options.headers = options.headers || {}
  options.cacheSrc = options.cacheSrc || __dirname + '/.sync'
  options.cacheDest = options.cacheDest || '/.sync'

  var client = knox.createClient(options)
    , queue = createQueue(options.concurrency)
    , region = options.region === 'us-standard' ? false : options.region
    , secure = options.secure || !('secure' in options)
    , subdomain = region ? 's3-' + region : 's3'
    , protocol = secure ? 'https' : 'http'

  var stream = es.map(function(data, next) {
    queue.defer(function(details, done) {
      details.fullPath = details.fullPath || details.src
      details.path = details.path || details.dest

      syncFile(details, function(err) {
        return err ? next(err) : done(), next(null, details)
      })
    }, data)
  })

  stream.getCache = getCache
  stream.putCache = putCache

  function syncFile(details, next) {
    var absolute = details.fullPath
      , relative = details.path
      , destination = url.resolve(
        protocol + '://' + subdomain + '.amazonaws.com/' + options.bucket + '/'
      , details.path
      )

    hashFile(absolute, function(err, md5) {
      if (err) return next(err)
      details.md5 = md5
      details.url = destination
      details.fresh = false
      details.cached = false

      if (!db) return checkForUpload(next)

      var key = 'md5:' + absolute

      db.get(key, function(err, result) {
        if (!err && result === md5) {
          details.cached = true
          return next(null, details)
        }
        checkForUpload(function(err) {
          if (err) return next(err)
          db.put(key, md5, next)
        })
      })
    })

    function checkForUpload(next) {
      client.headFile(relative, function(err, res) {
        if (err) return next(err)
        if (res.statusCode === 404 || res.headers.etag !== '"' + details.md5 + '"') return uploadFile(details, next)
        if (res.statusCode >= 300) return next(new Error('Bad status code: ' + res.statusCode))
        return next(null, details)
      })
    }
  }

  function uploadFile(details, next) {
    var absolute = details.fullPath
      , relative = details.path
      , lasterr
      , off = backoff.fibonacci({
        initialDelay: 1000
      })

    details.fresh = true

    off.failAfter(7)
    off.on('fail', function() {
      next(lasterr || new Error('unknown error'))
    }).on('ready', function() {
      var headers = xtend({
          'x-amz-acl': 'public-read-write'
        , 'Content-Type': mime.lookup(absolute)
      }, options.headers)

      client.putFile(absolute, relative, headers, function(err, res) {
        if (!err) {
          if (res.statusCode < 300) return next(null, details)
          err = new Error('Bad status code: ' + res.statusCode)
        }

        lasterr = err
        stream.emit('fail', err)
        off.backoff()
      })
    }).backoff()
  }

  function getCache(callback) {
    callback = once(callback)

    client.getFile(options.cacheDest, function(err, res) {
      if (err) return callback(err)
      if (res.statusCode === 404) return callback(null)

      es.pipeline(
          res
        , es.split()
        , es.parse()
        , db.createWriteStream()
      ).once('close', callback)
       .once('error', callback)
    })
  }

  function putCache(callback) {
    callback = once(callback)

    db.createReadStream()
      .pipe(es.stringify())
      .pipe(fs.createWriteStream(options.cacheSrc))
      .once('error', callback)
      .once('close', function() {
        client.putFile(options.cacheSrc, options.cacheDest, function(err) {
          if (err) return callback(err)
          fs.unlink(options.cacheSrc, callback)
        })
     })
  }

  return stream
}

function hashFile(filename, callback) {
  var hash = crypto.createHash('md5')
    , done = false

  fs.createReadStream(filename).on('data', function(d) {
    hash.update(d)
  }).once('error', function(err) {
    if (!done) callback(err)
    done = true
  }).once('close', function() {
    if (!done) callback(null, hash.digest('hex'))
    done = true
  })
}

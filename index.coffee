express = require 'express'
app = express()

global.logger = require('tracer').colorConsole()

global.basefolder = __dirname

env = 'dev'

for arg in process.argv
    [key, value] = arg.split '='
    env = value if key is '--env'

config = require('./config') env

bodyparser = require 'body-parser'
fileupload = require 'express-fileupload'
compression = require 'compression'

app.use bodyparser.json(limit: 1024 * 1024 * 64)
app.use bodyparser.urlencoded(extended: true, limit: 1024 * 1024 * 64)

app.use compression()

multipart = require 'connect-multiparty'
multipartMiddleware = multipart()
app.use multipartMiddleware

mongoose = require 'mongoose'
mongoose.connect config.db
global.MOI = mongoose.Types.ObjectId

global.models = require('./models/models')(mongoose)

global._ = require 'lodash'
global.async = require 'async'

require('./helpers/helpers')()

# Own middleware
require './middleware/params'
require './middleware/existence'


routes = require './routes'

getRouteConfig = (req, res, routes, callback) ->
    for r in routes
        if req._parsedUrl.pathname == r[1] and req.method == r[0]
            matchingRoute =
                method: r[0]
                route: r[1]
                controller: r[2].split('#')[0]
                action: r[2].split('#')[1]
                misc: r[3]

    if matchingRoute
        _routeConfig = matchingRoute

        _routeConfig.misc = {} if not _routeConfig.misc

        if _routeConfig.misc.upload
            fileupload() req, res, () =>
                callback _routeConfig
        else
            callback _routeConfig
    else
        res.status(500).send error: 'Invalid route'



app.use (req, res, next) ->
    # Serve static files
    if /^\/profilepicture/.test req.originalUrl
        res.sendFile "#{basefolder}/user#{req.originalUrl}"
    else
        next()

, (req, res, next) ->
    getRouteConfig req, res, routes, (_routeConfig) ->
        params = if JSON.stringify(req.query) isnt '{}' then req.query else req.body

        if _routeConfig.misc.mandatory && _routeConfig.misc.mandatory.length > 0
            availableParams = _routeConfig.misc.mandatory.filter (value) ->
                typeof params[value] isnt 'undefined' and params[value] isnt ''

            if availableParams.length < _routeConfig.misc.mandatory.length
                missingParams = _.difference _routeConfig.misc.mandatory, availableParams
                res.status(400).send error: 'Invalid request', missingParams: missingParams
                return

        async.waterfall [
            (callback) ->
                if params.hasOwnProperty 'access_token'
                    models.get('atoken').verify params.access_token, (result) ->
                        if not result
                            res.status(401).send error: 'Invalid access token'
                            return
                        else
                            params._userId = result.userId.toString()
                            callback()
                else
                    callback()
        ], () ->
            c = require('./controllers/' + _routeConfig.controller)()
            prefixedAction = "__#{_routeConfig.action}"

            files = {}
            files = req.files if req.files

            befores = []
            for mw in middleware
                befores.push mw.before if mw.hasOwnProperty 'before'
            befores[0] = async.apply befores[0], params

            async.waterfall befores, (err, params) ->
                if err
                    res.status(400).send err
                    return

                c[prefixedAction] params, (result, status) ->
                    status = 200 if not status

                    global.signupTimer = Date.now()

                    res.status(status).send result
                , files, res


app.listen 3131, () ->
    logger.log 'Running...'
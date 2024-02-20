import {buildSchema, graphql, validate} from 'graphql';
import {createHandler} from 'graphql-http/lib/use/express';
import * as fs from 'fs';
import express from 'express';
import {body, validationResult} from 'express-validator';
import { randomUUID } from 'crypto';
import { createClient } from '@redis/client';
import { spawn } from 'child_process';

// TODO: Overrequest protection (HTTP 429)

// Redis Database
const redis_server_process = spawn("redis-server", {
    cwd: "/home/dcf/",
    env: process.env
});

redis_server_process.stdout.on('data', (data) => {
    console.log(`[REDIS SERVER]:  ${data}`);
})

process.on('SIGINT', function(){
    redis_server_process.kill('SIGINT');
    process.exit();
});

const redis = await createClient()
.on('error', err => {
    console.error(err);
    process.exit();
})
.connect();

const luaScripts = {
    syncDelete: `do for k,v in pairs({'APPROVED', 'PENDING', 'DENIED'}) do redis.call('SREM', v, ARGV[1]) end return redis.call('DEL', ARGV[1]) end`,
    test: `return "hello"`
}


// GraphQL
const schema = buildSchema(fs.readFileSync('./schema.graphql',{encoding:'utf8'}));

const rootValue = {
    post: async ({id}) =>{
        let post = JSON.parse(await redis.GET(id));
        console.log(post);
        return post;
    },
    board: async ({status}) => {
        let keyset = await redis.SMEMBERS(status);
        console.log("REQUESTED SET: ", keyset);
        let list = await redis.MGET(keyset);
        list = list.map((x) => JSON.parse(x));
        //console.log(list);
        return list.sort((a, b) => {
            if(a.time < b.time){
                return 1;
            }
            if(a.time > b.time){
                return -1;
            }
            return 0;
        })
    },
    move: async ({id, newStatus}) => {
        let answer = await redis.SMOVE("PENDING", newStatus, id);
        console.log(`[API] move(${newStatus}, ${id}): `, answer);
        return answer;
    },
    delete: async ({id}) =>{
        let answer = await redis.EVAL(luaScripts.syncDelete, {
            arguments:[id]
        });
        console.log(`[API] delete(${id}): `, answer);
        return answer;
    }
}

async function query(_query_){
    return new Promise((resolve, reject)=>{
        graphql({
            schema,
            source: _query_,
            rootValue
        }).then(response =>{
            resolve(response);
        })
    })
}

//ExpressJS
var waiting = false;
function limiter(){
    if (waiting){
        return true;
    }
    waiting = true;
    setTimeout(()=>{
        waiting = true;
    }, 1000) // 60000 = 1min
    return false;
}

const interruptor = function(req, res, next){
    redis.GET("__end__").then((red) => {
        console.log("is __end__? ", red == true);
        if(red == true){
            return res.status(503).sendFile(process.cwd() + "/ended.html");
        }
        next();
    })
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({extended: true}));
app.use(express.static(process.cwd() + "/static"));
app.use(interruptor);

const port = 8000;

app.get('/', (req, res) => {
    res.sendFile(process.cwd() + "/index.html");
})

app.get('/pending', (req, res) => {
    res.sendFile(process.cwd() + "/pending.html");
})

async function put(object){
    let n_status = "PENDING";
    let n_post = {
        id: randomUUID().slice(0,8),
        time: Date.now(),
        author: object.author,
        content: object.content,
    }
    await redis.SET(n_post.id, JSON.stringify(n_post));
    await redis.SADD(n_status, n_post.id);
    return n_post.id;
}

app.post('/', [
    body("content").notEmpty().escape(),
    body("author").notEmpty().escape(),
] ,(req, res) =>{
    const errors = validationResult(req);

    if(!errors.isEmpty()){
        console.log(errors);
        return res.sendStatus(400);
    }

    if(req.body.content == "do you see it?"){
        redis.SET("__end__", "1");
        return res.sendStatus(418);
    }

    if(limiter()){
        console.log("[EXPRESS]: Limiter Triggered");
        return res.sendStatus(429);
    }

    console.log("[EXPRESS] New Submission: ", req.body);

    let new_id = put(req.body);
    res.status(200);
    res.set({
        "Content-Type":"application/json"
    })
    new_id.then((n)=>{
        res.send(JSON.stringify({id: n}));
    })
    
})

app.all('/api', createHandler({schema: schema, rootValue: rootValue}));

app.listen(port, ()=>{
    console.log(`Server listening on ${port}`);
})

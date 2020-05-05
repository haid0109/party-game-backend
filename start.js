const express = require("express");
const app = express();
const path = require("path");
const busboy = require("express-busboy");
const mongoose = require('mongoose');
const {v4: uuidv4} = require('uuid');
const minio = require('minio');
const customId = require("custom-id");
const fs = require("fs");
const WAA = require("web-audio-api");
const audioBufferToWav = require("audiobuffer-to-wav");

let GameModel = null;
let minioClient = null;

function shuffleArray(array) {
    for (let arrayIndex = 0; arrayIndex < array.length; arrayIndex++) {
        const randomNum = Math.floor(Math.random() * (arrayIndex + 1));
        [array[arrayIndex], array[randomNum]] = [array[randomNum], array[arrayIndex]];
    }
}

async function settingUpMongoDBAndMinio(){
    //connect to MongoDB
    await mongoose.connect("mongodb://partygame:partygame@localhost:27017/partygame", { 
        useNewUrlParser: true, 
        useCreateIndex: true, 
        useFindAndModify: false, 
        useUnifiedTopology: true 
    });

    //create model
    GameModel = mongoose.model("Game", {
        gameCode: String,
        game: Object
    });

    //connect to Minio
    minioClient = new minio.Client({
        endPoint: '127.0.0.1',
        port: 9000,
        useSSL: false,
        accessKey: 'AKIAIOSFODNN7EXAMPLE',
        secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
    });

    //check if bucket exists
    let gamebucketExists = null;
    await minioClient.bucketExists("gamebucket")
    .then(exists => gamebucketExists = exists)
    .catch(err => console.log("checking if bucket exists failed: ", err));

    //create bucket if it does not exist
    if(!gamebucketExists){
        await minioClient.makeBucket("gamebucket")
        .catch(err => console.log("creating a bucket failed: ", err));
    }

    //creates game
    await GameModel.create({
        gameCode: "22222",
        game: {
            state: "initialized",
            players: [
                {
                    secretKey: uuidv4(),
                    name: "haidar"
                }
            ],
            numberOfRounds: 0,
        }
    })
    // .then(() => res.send())
    .catch((err) => {
        console.log(err);
        // res.status(500).send();
    });

    // //gets game
    // await GameModel.findOne({gameCode: "22222"})
    // .then(game => console.log(game))
    // // .then(() => res.send())
    // .catch((err) => {
    //     console.log(err);
    //     // res.status(500).send();
    // });

    //updates game
    await GameModel.updateMany({gameCode: "22222"}, {
        $set: {game: {
            state: "initialized",
            players: [],
            numberOfRounds: 0,
        }}
    })
    // .then(() => res.send())
    .catch((err) => {
        console.log(err);
        // res.status(500).send();
    });

    //deletes game
    await GameModel.deleteMany({gameCode: "22222"})
    // .then(() => res.send())
    .catch((err) => {
        console.log(err);
        // res.status(500).send();
    });

}

settingUpMongoDBAndMinio();

app.use(function (req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    next();
});
app.use(express.json());

app.get("/game/:gameCode", (req, res) => {
    let gameCode = req.params.gameCode.toUpperCase();

    GameModel.findOne({"gameCode": gameCode})
    .then((gameDocument) => {
        if(!gameDocument){return res.status(404).send();}
        res.send(gameDocument.game);
    })
    .catch(err => console.log("getting gameDocument object failed: ", err));
});

app.post("/game/new", async (req, res) => {
    let gameCode = customId({});
    let playerObj = {
        secretKey: uuidv4(),
        name: req.body.name,
        audioMetaData: "test"
    };
    
    await GameModel.findOne({"gameCode": gameCode})
    .then((gameDocument) => {
        if(!!gameDocument){return gameCode = null;}
    })
    .catch((err) => {
        console.log("getting gameDocument object failed: ", err);
        res.status(500).send();
    });
    if(!gameCode){return res.status(503).send();}

    GameModel.create({
        "gameCode": gameCode,
        "game": {
            "state": "preround",
            "players": [playerObj],
            "numberOfRounds": "0",
            "currentRound": "0",
        }
    })
    .then(() => {
        res.send({
            secretKey: playerObj.secretKey,
            code: gameCode
        })
    })
    .catch((err) => {
        console.log("creating new game failed", err);
        res.status(500).send();
    });
});
 
app.patch("/game/join/:gameCode", async (req, res) => {// is it a patch or post request?
    let gameCode = req.params.gameCode.toUpperCase();
    let game = null;
    let player = null;
    let playerObj = {
        secretKey: uuidv4(),
        name: req.body.name,
        audioMetaData: "test"
    };

    await GameModel.findOne({"gameCode": gameCode})
    .then((gameDocument) => {
        if(!gameDocument){return;}
        game = gameDocument.game;
        player = game.players.find(player => player.name == playerObj.name);
    })
    .catch(err => console.log("getting gameDocument object failed: ", err));
        
    if(!game){return res.status(404).send();}
    if(!!player){return res.status(403).send();}
    if(game.state != "preround"){return res.status(400).send();}

    GameModel.updateOne(
        {"gameCode": gameCode},
        {"$push": 
            {"game.players": playerObj}
        }
    )
    .then(() => res.send({secretKey: playerObj.secretKey}))
    .catch((err) => {
        console.log("adding player to game failed: ", err);
        res.status(500).send();
    });
});

app.get("/game/player/exist/:gameCode/:secretKey", (req, res) => {
    let gameCode = req.params.gameCode.toUpperCase();
    let secretKey = req.params.secretKey;

    GameModel.findOne({"gameCode": gameCode})
    .then((gameDocument) => {
        if(!gameDocument){return res.status(404).send();}
        let player = gameDocument.game.players.find(player => player.secretKey == secretKey);
        if(!player){return res.status(403).send()}
        res.send();
    })
    .catch(err => console.log("getting gameDocument object failed: ", err));
});

app.get("/game/players/:gameCode", (req, res) => {
    let gameCode = req.params.gameCode.toUpperCase();

    GameModel.findOne({"gameCode": gameCode})
    .then((gameDocument) => {
        if(!gameDocument){return res.status(404).send();}
        let playerNamesAndStatus = [];
        gameDocument.game.players.forEach(player => {
            playerNamesAndStatus.push({
                name: player.name,
                playerReady: player.playerReady,
            });
        });
        res.send({playersArray: playerNamesAndStatus});
    })
    .catch(err => console.log("getting gameDocument object failed: ", err));
});

app.get("/game/state/:gameCode", (req, res) => {
    let gameCode = req.params.gameCode.toUpperCase();

    GameModel.findOne({"gameCode": gameCode})
    .then((gameDocument) => {
        if(!gameDocument){return res.status(404).send();}
        res.send({state: gameDocument.game.state});
    })
    .catch((err) => {
        console.log("getting gameDocument object failed: ", err);
        res.status(500).send();
    });
});

app.patch("/game/start/:gameCode", async (req, res) => {// is it a patch or post request?
    let gameCode = req.params.gameCode.toUpperCase();
    let numOfPlayersReady = 0;
    let gameAlreadyStarted = true;
    let allPlayersAreReady = null;
    let players = null;

    //checks if all players are ready, and gets the players array for later use
    await GameModel.findOne({"gameCode": gameCode})
    .then((gameDocument) => {
        if(!gameDocument){return}
        if(gameDocument.game.currentRound == 0){return gameAlreadyStarted = false;}

        gameDocument.game.players.forEach(player => {
            if(player.playerReady){numOfPlayersReady++;}
        });

        if(gameDocument.game.players.length != numOfPlayersReady){return;}
        allPlayersAreReady = true;
        players = gameDocument.game.players;
    })
    .catch((err) => {
        console.log("getting gameDocument object failed: ",err);
        res.status(500).send();
    });

    if(gameAlreadyStarted){return res.status(403).send();}
    if(!allPlayersAreReady){return res.status(404).send();}
    shuffleArray(players);

    //sets the game state, new shuffled players array, and round count
    GameModel.updateOne(
        {"gameCode": gameCode},
        {"$set": 
            {
                "game.state": "in progress",
                "game.players": players,
                "game.numberOfRounds": numOfPlayersReady,
                "game.currentRound": "1"
            }
        }
    )
    .then(() => {res.send();})
    .catch((err) => {
        console.log("starting game failed: ", err);
        res.status(500).send();
    });
});

busboy.extend(app, {
    upload: true
});

app.post("/game/player/audio/:gameCode/:secretKey", async (req, res) => {//patch or post request?
    let gameCode = req.params.gameCode.toUpperCase();
    let secretKey = req.params.secretKey;
    let audioDataPath = req.files.audio.file;

    let audioId = uuidv4();
    let parsedAudioMetaData = JSON.parse(req.body.audioMetaData);
    let correctAnswer = parsedAudioMetaData.answer;
    let audioSpeed = parsedAudioMetaData.speed;
    let audioReverse = parsedAudioMetaData.reverse;

    let audioObj = {
        audioId: audioId,
        answer: correctAnswer,
        speed: audioSpeed,
        reverse: audioReverse
    }

    let arrayBufferWav = null;
    
    //reverses audio data and saves it in minio
    if(audioReverse){
        let buffer = fs.readFileSync(audioDataPath);
        let audioCtx = new WAA.AudioContext();
        audioCtx.decodeAudioData(buffer, 
            function(audioBuffer) {
                Array.prototype.reverse.call( audioBuffer.getChannelData(0) );
                Array.prototype.reverse.call( audioBuffer.getChannelData(1) );
                arrayBufferWav = audioBufferToWav(audioBuffer);
                minioClient.putObject("gamebucket", `${audioId}.wav`, Buffer.from(arrayBufferWav))
                .then(() => res.send())
                .catch((err) => {
                    console.log("uploading reversed audio data to minio failed: ", err);
                    res.status(500).send();
                });
            },
            function(err){
                console.log("Error with decoding audio data: ", err);
                res.status(500); //does not work
            }
        );
    }
    else{
        minioClient.putObject("gamebucket", `${audioId}.wav`, Buffer.from(arrayBufferWav))
        .then(() => res.send())
        .catch((err) => {
            console.log("uploading reversed audio data to minio failed: ", err);
            res.status(500).send();
        });
    }

    //assigns audio meta data in db
    await GameModel.findOneAndUpdate(
        {
            "gameCode": gameCode,
            "game.players.secretKey": secretKey
        },
        {
            $set: {"game.players.$.audioMetaData": audioObj} 
        }
    )
    .then(() => res.send())
    .catch((err) => {
        console.log("uploading audio meta data failed: ", err);
        res.status(500).send();
    });
});

app.get("/game/player/audio/data/:gameCode/:secretKey", (req, res) => {//how?
    let gameCode = req.params.gameCode.toUpperCase();
    let secretKey = req.params.secretKey;

    // GameModel.findOne(
    //     {"game.players.$.secretKey": secretKey}
    // )
    // .then((gameDocument) => {
    //     res.send(gameDocument);
    // })
    // .catch((err) => {
    //     console.log(err);
    //     res.status(500).send();
    // });

    GameModel.findOne(
        {"game.players.secretKey": secretKey},
        {"game.players.audioMetaData": true}
    )
    .then((gameDocument) => {
        res.send(gameDocument);
    })
    .catch((err) => {
        console.log(err);
        res.status(500).send();
    });

    // GameModel.findOne({}, {"gameCode": gameCode, "game.players": {$elemMatch: {"secretKey": secretKey}}})
    // .then((gameDocument) => {
    //     res.send(gameDocument);
    // })
    // .catch((err) => {
    //     console.log(err);
    //     res.status(500).send();
    // });

    // GameModel.findOne({
    //     "gameCode": gameCode,
    //     "game.players.secretKey": secretKey
    // })
    // .then((gameDocument) => {
    //     res.send(gameDocument);
    // })
    // .catch((err) => {
    //     console.log(err);
    //     res.status(500).send();
    // });

    // let buffer = ;
    // res.send();
});

app.get("/game/player/audio/speed/:gameCode/:secretKey", (req, res) => {
    let gameCode = req.params.gameCode.toUpperCase();
    let secretKey = req.params.secretKey;

    res.send({speed: player.speed});
});

app.get("/game/round/audio/:gameCode/:roundNum", (req, res) => {
    let gameCode = req.params.gameCode.toUpperCase();
    let roundIndex = req.params.roundNum - 1;
    if(!game.players[roundIndex]) {
        return res.status(404).send();
    }
    let buffer = fs.readFileSync(game.players[roundIndex].audioPath);
    res.send(buffer);
});

app.get("/game/round/audio/speed/:gameCode/:roundNum", (req, res) => {
    let gameCode = req.params.gameCode.toUpperCase();
    let roundIndex = req.params.roundNum - 1;
    if(!game.players[roundIndex]) {
        return res.status(404).send();
    }
    res.send({speed: game.players[roundIndex].speed});
});

app.post("/game/saveGuess/:gameCode", (req, res) => {
    let gameCode = req.params.gameCode.toUpperCase();
    let playerName = req.body.playerName;
    let playerGuess = req.body.guess;
    let player = checkIfPlayerExist(playerName);

    if(!player.guess){player.guess = [];}
    player.guess.push(playerGuess);
    res.send();
});

app.get("/game/round/last/:gameCode", (req, res) => {
    let gameCode = req.params.gameCode.toUpperCase();

    GameModel.findOne({"gameCode": gameCode})
    .then((gameDocument) => {
        if(!gameDocument){return}
        if(gameDocument.game.currentRound != gameDocument.game.numberOfRounds){return res.send(404);}
        res.send();
    })
    .catch((err) => {
        console.log(err);
        res.status(500).send();
    });
});

app.patch("/game/round/next/:gameCode/:roundNum", async (req, res) => {// new http request
    let gameCode = req.params.gameCode.toUpperCase();
    let roundNum = req.params.roundNum;
    let roundAlreadyChanged = true;
    let gameNotStarted = true;

    await GameModel.findOne({"gameCode": gameCode})
    .then((gameDocument) => {
        if(!gameDocument){return}
        if(gameDocument.game.currentRound == roundNum){return roundAlreadyChanged = false;}
        if(gameDocument.game.state == "in progress"){return gameNotStarted = false;}
    })
    .catch((err) => {
        console.log(err);
        res.status(500).send();
    });

    if(roundAlreadyChanged){return res.status(403).send();}
    if(gameNotStarted){return res.status(404).send();}

    GameModel.updateOne(
        {"gameCode": gameCode},
        {"$set": 
            {"game.currentRound": ++roundNum}
        }
    )
    .then(() => {res.send();})
    .catch((err) => {
        console.log(err);
        res.status(500).send();
    });
});

app.get("/game/players/answered/:gameCode/:roundNum", (req, res) => {
    let gameCode = req.params.gameCode.toUpperCase();
    let roundIndex = req.params.roundNum - 1;
    let numberOfPlayersAnswered = 0;

    game.players.forEach(player => {
        if(!player.guess){return;}
        if(!!player.guess[roundIndex]){numberOfPlayersAnswered++}
    });
    if(numberOfPlayersAnswered == game.numberOfRounds){res.send();}
    else{res.status(404).send();}
});

app.get("/game/round/results/:gameCode/:playerName", (req, res) => {
    let gameCode = req.params.gameCode.toUpperCase();
    let roundIndex = req.params.roundNum - 1;
    let playerName = req.params.playerName;
    let player = checkIfPlayerExist(playerName);
    let playerGuess = player.guess[roundIndex];
    let correctAnswer = game.players[roundIndex].answer;
    if(playerGuess == correctAnswer)
    {
        if(!player.score){player.score = 0;}
        player.score++;
        res.send();
    }
    else{res.status(404).send(correctAnswer);}
});

app.get("/game/players/scores/:gameCode", (req, res) => {
    let gameCode = req.params.gameCode.toUpperCase();
    if(!!game.players){
        res.send({players: game.players});
    }
    else{ res.status(404).send("there are no players"); }
});

app.listen(9423);

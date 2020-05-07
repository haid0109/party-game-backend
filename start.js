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
const concat = require('concat-stream')

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
        guess: [],
        score: 0,
        done: false
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
 
app.put("/game/join/:gameCode", async (req, res) => {// is it a put or post request?
    let gameCode = req.params.gameCode.toUpperCase();
    let game = null;
    let player = null;
    let playerObj = {
        secretKey: uuidv4(),
        name: req.body.name,
        guess: [],
        score: 0,
        done: false
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

app.get("/game/player/exist/:gameCode/:secretKey", (req, res) => {// needs to be changed to use Db to check if player exist
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

app.put("/game/start/:gameCode", async (req, res) => {// is it a put or post request?
    let gameCode = req.params.gameCode.toUpperCase();
    let numOfPlayersReady = 0;
    let gameAlreadyStarted = true;
    let allPlayersAreReady = null;
    let players = null;

    //checks if all players are ready, and gets the players array for later use
    await GameModel.findOne({"gameCode": gameCode})
    .then((gameDocument) => {
        if(!gameDocument){return}
        if(gameDocument.game.currentRound == 0){gameAlreadyStarted = false;}

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
    let arrayBufferWav = null;
    let game = null;

    let parsedAudioMetaData = JSON.parse(req.body.audioMetaData);
    let audioMetaDataObj = {
        audioId: "",
        answer: parsedAudioMetaData.answer,
        speed: parsedAudioMetaData.speed,
        reverse: parsedAudioMetaData.reverse
    }

    await GameModel.findOne(
        {
            "gameCode": gameCode,
            "game.players.secretKey":  secretKey
        },
        {"game.players.audioMetaData.$": 1}
    )
    .then((gameDocument) => {
        if(!!gameDocument){game = true;}
        if(!!gameDocument.game.players[0].audioMetaData.audioId)
        {
            return audioMetaDataObj.audioId = gameDocument.game.players[0].audioMetaData.audioId;
        }
        audioMetaDataObj.audioId = uuidv4();
    })
    .catch((err) => {
        console.log("checking if audioId exists failed: ", err);
        res.status(500).send();
    });
    if(!game){return res.status(404).send;}
    
    //reverses audio data and saves it in minio
    if(audioMetaDataObj.reverse){
        let buffer = fs.readFileSync(audioDataPath);
        let audioCtx = new WAA.AudioContext();
        audioCtx.decodeAudioData(buffer, 
            function(audioBuffer) {
                Array.prototype.reverse.call( audioBuffer.getChannelData(0) );
                Array.prototype.reverse.call( audioBuffer.getChannelData(1) );
                arrayBufferWav = audioBufferToWav(audioBuffer);
                minioClient.putObject("gamebucket", `${audioMetaDataObj.audioId}.wav`, Buffer.from(arrayBufferWav))
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
        minioClient.putObject("gamebucket", `${audioMetaDataObj.audioId}.wav`, Buffer.from(arrayBufferWav))
        .catch((err) => {
            console.log("uploading audio data to minio failed: ", err);
            res.status(500).send();
        });
    }

    //assigns audio meta data in db
    GameModel.findOneAndUpdate(
        {
            "gameCode": gameCode,
            "game.players.secretKey": secretKey
        },
        {
            $set: {"game.players.$.audioMetaData": audioMetaDataObj} 
        }
    )
    .then(() => res.send())
    .catch((err) => {
        console.log("uploading audio meta data failed: ", err);
        res.status(500).send();
    });
});

app.get("/game/player/audio/data/:gameCode/:secretKey", async (req, res) => {
    let gameCode = req.params.gameCode.toUpperCase();
    let secretKey = req.params.secretKey;
    let game = false;
    let audioId = null;
    let buffer = null;

    await GameModel.findOne(
        {
            "gameCode": gameCode,
            "game.players.secretKey":  secretKey
        },
        {"game.players.audioMetaData.$": 1}
    )
    .then((gameDocument) => {
        if(!!gameDocument){game = true;}
        audioId = gameDocument.game.players[0].audioMetaData.audioId;
    })
    .catch((err) => {
        console.log("getting specific audioId failed: ", err);
        res.status(500).send();
    });
    if(!game){return res.status(404).send();}

    minioClient.getObject("gamebucket", `${audioId}.wav`)
    .then((dataStream) => {
        dataStream.pipe(concat(buffer => res.send(buffer)))
    })
    .catch((err) => {
        console.log("getting audio data from minio failed: ", err);
        res.status(500).send();
    });
});

app.get("/game/player/audio/metaData/:gameCode/:secretKey", (req, res) => {
    let gameCode = req.params.gameCode.toUpperCase();
    let secretKey = req.params.secretKey;
    let metaDataObj = {
        speed: "",
        reverse: ""
    }

    GameModel.findOne(
        {
            "gameCode": gameCode,
            "game.players.secretKey":  secretKey
        },
        {"game.players.audioMetaData.$": 1}
    )
    .then((gameDocument) => {
        if(!gameDocument){return res.status(404).send();}
        metaDataObj.speed = gameDocument.game.players[0].audioMetaData.speed;
        metaDataObj.reverse = gameDocument.game.players[0].audioMetaData.reverse;
        res.send(metaDataObj);
    })
    .catch((err) => {
        console.log("getting specific audioMetaData failed: ", err);
        res.status(500).send();
    });
});

app.get("/game/round/exist/:gameCode/:roundNum", (req, res) => {
    let gameCode = req.params.gameCode.toUpperCase();
    let roundNum = req.params.roundNum;

    GameModel.findOne({"gameCode": gameCode})
    .then((gameDocument) => {
        if(!gameDocument){return res.status(404).send();}
        if(gameDocument.game.currentRound != roundNum){return res.status(403).send()}
        res.send();
    })
    .catch(err => console.log("getting gameDocument object failed: ", err));
});

app.get("/game/round/audio/data/:gameCode", async (req, res) => {// all double or more requests should be handled like this one(gameExist) but status code 500 is overwritten with 404(results in error)
    let gameCode = req.params.gameCode.toUpperCase();
    let gameExist = true;
    let audioId = "";

    await GameModel.findOne({"gameCode": gameCode})
    .then((gameDocument) => {
        if(!gameDocument){return gameExist = false;}
        let playerIndex = gameDocument.game.currentRound - 1;
        audioId = gameDocument.game.players[playerIndex].audioMetaData.audioId;
    })
    .catch((err) => {
        console.log("getting game document failed: ", err);
        gameExist = false;
        res.status(500).send();
    });
    if(!gameExist){return res.status(404).send();}

    minioClient.getObject("gamebucket", `${audioId}.wav`)
    .then((dataStream) => {
        dataStream.pipe(concat(buffer => res.send(buffer)))
    })
    .catch((err) => {
        console.log("getting round audio data from minio failed: ", err);
        res.status(500).send();
    });
});

app.get("/game/round/audio/metaData/:gameCode", (req, res) => {
    let gameCode = req.params.gameCode.toUpperCase();
    let metaDataObj = {
        speed: "",
        reverse: ""
    }

    GameModel.findOne({"gameCode": gameCode})
    .then((gameDocument) => {
        if(!gameDocument){return res.status(404).send();}
        let playerIndex = gameDocument.game.currentRound - 1;
        metaDataObj.speed = gameDocument.game.players[playerIndex].audioMetaData.speed;
        metaDataObj.reverse = gameDocument.game.players[playerIndex].audioMetaData.reverse;
        res.send(metaDataObj);
    })
    .catch((err) => {
        console.log("getting game document failed: ", err);
        res.status(500).send();
    });
});

app.put("/game/player/saveGuess/:gameCode/:secretKey", (req, res) => {//put or post request?
    let gameCode = req.params.gameCode.toUpperCase();
    let secretKey = req.params.secretKey;
    let playerGuess = req.body.guess;

    GameModel.findOneAndUpdate(
        {
            "gameCode": gameCode,
            "game.players.secretKey": secretKey
        },
        {
            $push: {"game.players.$.guess": playerGuess} 
        }
    )
    .then(() => res.send())
    .catch((err) => {
        console.log("uploading player guess failed: ", err);
        res.status(500).send();
    });
});

app.get("/game/players/answered/:gameCode", (req, res) => {
    let gameCode = req.params.gameCode.toUpperCase();

    GameModel.findOne({"gameCode": gameCode})
    .then((gameDocument) => {
        if(!gameDocument){return res.status(404).send();}
        let roundIndex = gameDocument.game.currentRound - 1;
        let numberOfPlayersAnswered = 0;
        gameDocument.game.players.forEach(player => {
            if(!!player.guess[roundIndex]){numberOfPlayersAnswered++}
        });
        console.log(gameDocument.game.players.length); //remove later
        console.log(gameDocument.game.numberOfRounds); //remove later
        if(numberOfPlayersAnswered != gameDocument.game.players.length){return res.status(403).send();}
        res.send();
    })
    .catch((err) => {
        console.log("checking if all players answered failed: ", err);
        res.status(500).send();
    });
});

app.get("/game/round/results/:gameCode/:secretKey", async (req, res) => {
    let gameCode = req.params.gameCode.toUpperCase();
    let secretKey = req.params.secretKey;
    let gameExist = true;
    let AnswerIsCorrect = false;
    let correctAnswer = "";

    await GameModel.findOne({"gameCode": gameCode})
    .then((gameDocument) => {
        if(!gameDocument){return gameExist = false;}
        let roundIndex = gameDocument.game.currentRound - 1;
        correctAnswer = gameDocument.game.players[roundIndex].audioMetaData.answer;
    })
    .catch((err) => {
        console.log("getting correct answer failed: ", err);
        gameExist = false;
        res.status(500).send();
    });
    if(!gameExist){return res.status(404).send()}

    await GameModel.findOne(
        {
            "gameCode": gameCode,
            "game.players.secretKey":  secretKey
        },
        {"game.players.audioMetaData.$": 1}
    )
    .then((gameDocument) => {
        if(!gameDocument){return gameExist = false;}
        let playerGuess = gameDocument.game.players[0].guess
        if(playerGuess != correctAnswer){return}
        AnswerIsCorrect = true;
    })
    .catch((err) => {
        console.log("checking if player guess is correct failed: ", err);
        gameExist = false;
        res.status(500).send();
    });
    if(!gameExist){return res.status(404).send()}
    if(!AnswerIsCorrect){return res.status(403).send(correctAnswer)}

    GameModel.findOneAndUpdate(
        {
            "gameCode": gameCode,
            "game.players.secretKey": secretKey
        },
        {
            $inc: {"game.players.$.score": 1} 
        }
    )
    .then(() => res.send())
    .catch((err) => {
        console.log("setting player score failed: ", err);
        res.status(500).send();
    });
});

app.get("/game/round/last/:gameCode", (req, res) => {
    let gameCode = req.params.gameCode.toUpperCase();

    GameModel.findOne({"gameCode": gameCode})
    .then((gameDocument) => {
        if(!gameDocument){return res.status(404).send();}
        if(gameDocument.game.currentRound != gameDocument.game.numberOfRounds){return res.status(403).send();}
        res.send();
    })
    .catch((err) => {
        console.log("checking if it is the last round failed: ", err);
        res.status(500).send();
    });
});

app.put("/game/round/next/:gameCode/:roundNum", async (req, res) => {//put or post request?
    let gameCode = req.params.gameCode.toUpperCase();
    let roundNum = req.params.roundNum;
    let gameNotStarted = true;
    let roundAlreadyChanged = true;

    await GameModel.findOne({"gameCode": gameCode})
    .then((gameDocument) => {
        if(!gameDocument){return}
        if(gameDocument.game.state == "in progress"){gameNotStarted = false;}
        if(gameDocument.game.currentRound == roundNum){roundAlreadyChanged = false;}
    })
    .catch((err) => {
        console.log("checking if game was not started or round was already changed failed: ", err);
        res.status(500).send();
    });

    if(gameNotStarted){return res.status(404).send();}
    if(roundAlreadyChanged){return res.status(403).send();}

    GameModel.updateOne(
        {"gameCode": gameCode},
        {"$set": 
            {"game.currentRound": ++roundNum}
        }
    )
    .then(() => {res.send();})
    .catch((err) => {
        console.log("updating current round failed: ", err);
        res.status(500).send();
    });
});

app.get("/game/players/scores/:gameCode", (req, res) => {
    let gameCode = req.params.gameCode.toUpperCase();

    GameModel.findOne({"gameCode": gameCode})
    .then((gameDocument) => {
        if(!gameDocument){return res.status(404).send();}
        let namesAndScores = [];
        gameDocument.game.players.forEach(player => {
            namesAndScores.push({
                name: player.name,
                score: player.score
            })
        });
        res.send(namesAndScores);
    })
    .catch((err) => {
        console.log("getting game results failed: ", err);
        res.status(500).send();
    });
});

app.put("/game/player/done/:gameCode/:secretKey", async (req, res) => {//put or post request?
    let gameCode = req.params.gameCode.toUpperCase();
    let secretKey = req.params.secretKey;
    let gameExist = true;
    let lastRound = true;

    await GameModel.findOne({"gameCode": gameCode})
    .then((gameDocument) => {
        if(!gameDocument){return gameExist = false;}
        if(gameDocument.game.numberOfRounds != gameDocument.game.currentRound){lastRound = false}
    })
    .catch((err) => {
        console.log("checking if it was the last round of the game failed: ", err);
        gameExist = false;
        res.status(500).send();
    });

    if(!gameExist){return res.status(404).send();}
    if(!lastRound){return res.status(403).send();}

    GameModel.findOneAndUpdate(
        {
            "gameCode": gameCode,
            "game.players.secretKey": secretKey
        },
        {
            $set: {"game.players.$.done": true} 
        }
    )
    .then(() => res.send())
    .catch((err) => {
        console.log("updating that the player is done with the game failed: ", err);
        res.status(500).send();
    });
});

app.delete("/game/over/:gameCode", async (req, res) => {//put or post request?
    let gameCode = req.params.gameCode.toUpperCase();
    let gameExist = true;
    let numOfPlayers = 0;
    let playersDone = 0;
    let allAudioIds = [];

    await GameModel.findOne({"gameCode": gameCode})
    .then((gameDocument) => {
        if(!gameDocument){return gameExist = false;}
        numOfPlayers = gameDocument.game.players.length;
        gameDocument.game.player.forEach(player => {
            if(player.done){
                playersDone++;
                allAudioIds.push(player.metaDataObj.audioId);
            }
        });
    })
    .catch((err) => {
        console.log("checking if it was the last round of the game failed: ", err);
        gameExist = false;
        res.status(500).send();
    });

    if(!gameExist){return res.status(404).send();}
    if(numOfPlayers != playersDone){return res.status(403).send();}

    GameModel.findOneAndRemove({"gameCode": gameCode})
    .then(resp => console.log(resp))
    .catch((err) => {
        console.log("removing game from mongodb failed: ", err);
        res.status(500).send();
    });

    minioClient.removeObjects("gamebucket", allAudioIds)
    .then(resp => console.log(resp))
    .catch((err) => {
        console.log("removing all game audio files from minio failed: ", err);
        res.status(500).send();
    });
});

app.listen(9423);

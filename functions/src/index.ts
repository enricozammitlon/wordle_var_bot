import axios from "axios";
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import emoji = require("node-emoji");
import uuid = require("uuid");

admin.initializeApp();
const db = admin.firestore();

export const healthz = functions.https.onRequest(async (_request, response) => {
  functions.logger.info("Healthz invoked", {structuredData: true});
  const res = await axios
      .get(`${process.env.TELEGRAM_API}${process.env.A_TOKEN}/getMe`)
      .then((res) => {
        return res.data.result;
      })
      .catch((error) => {
        return error;
      });
  response.send(res);
});

const mapping: {[key:string]: number} = {
  "one": 1,
  "two": 2,
  "three": 3,
  "four": 4,
  "five": 5,
  "six": 6,
  "seven": 7,
  "eight": 8,
  "nine": 9,
};

const getGame = (message : string) => {
  if (message.includes("https://www.flagle.io") && message.includes("#Flagle")) {
    return "flagle";
  } else if (message.includes("Wordle") && message.includes("/6")) {
    return "wordle";
  } else if (message.includes("kelma.mt") && message.includes("/6")) {
    return "kelma";
  } else if (message.includes("Daily Quordle") &&
    message.includes("quordle.com")) {
    return "quordle";
  } else return "other";
};

const parseScore = (message: string, game :string) => {
  let score = 0;
  functions.logger.info(game);
  if (["flagle", "kelma", "wordle"].includes(game)) {
    const stringScore = message.split(" ")[2].split("/")[0];
    score = stringScore == "X" ? 7 : parseInt(stringScore);
    return score;
  } else if (game === "quordle") {
    const emojis = [emoji.unemojify(message.split("\n")[1]).split("::"),
      emoji.unemojify(message.split("\n")[2]).split("::")].flat();
    functions.logger.info(emojis, {structuredData: true});
    emojis.forEach((e : string) => {
      const currentEmoji = e.replace(":", "");
      if (currentEmoji == "large_red_square") {
        score+=10;
      } else {
        score += mapping[currentEmoji];
      }
    });
    // score = score == "X" ? "0" : score;
    return score;
  } else return NaN;
};

// Telegram will post request updates here
export const receiveWebhook = functions.https.onRequest(
    async (request, response) => {
      const today = new Date(
          new Date().toLocaleString("en-US", {timeZone: "Europe/Rome"}))
          .setUTCHours(0, 0, 0, 0);

      functions.logger.info(today,
          {structuredData: true});
      functions.logger.info("Update event received from webhook",
          {structuredData: true});
      functions.logger.info(request.body, {structuredData: true});

      const message = request.body.message;
      if (message == null) {
        response.send("Update received for non game");
        return;
      }
      const username = message.from.username;
      const content = message.text;

      if (content == null) {
        response.send("Update received for non game");
        return;
      }
      functions.logger.info("Update received for game", {structuredData: true});
      if (content === "/leaderboard") {
        const id = message.chat.id;
        functions.logger.info("Leaderboard command", {structuredData: true});
        const leaderboard = await getLeaderboard(id.toString())
            .then((e) => e)
            .catch((e)=>{
              response.send(e); return;
            });
        await axios
            .post(
                // eslint-disable-next-line max-len
                `${process.env.TELEGRAM_API}${process.env.A_TOKEN}/sendMessage`,
                {chat_id: id, text: leaderboard})
            .then((res) => {
              return res;
            })
            .catch((error) => {
              return error;
            });
      }
      const game = getGame(content);
      if (game == "other") {
        response.send("Update received for non game");
        return;
      }
      const score = parseScore(content, game);


      const highscoreRef = db.collection("daily_highscore").doc(uuid.v4());
      const id = message.chat.id;
      await highscoreRef.set({
        chat_id: id.toString(),
        date: today,
        username: username,
        game: game,
        score: score,
      }, {merge: true})
          .then(() => functions.logger.info("Score pushed to db"))
          .catch(
              (error) => functions.logger.error(error, {structuredData: true}));
      response.send("Update received");
    });


const groupBy = <T, K extends keyof any>(list: T[], getKey: (item: T) => K) =>
  list.reduce((previous, currentItem) => {
    const group = getKey(currentItem);
    if (!previous[group]) previous[group] = [];
    previous[group].push(currentItem);
    return previous;
  }, {} as Record<K, T[]>);

const getLeaderboard = async (chatId : string, game? : string) => {
  const orderedList : {[key:string]: string}[] = [];
  let filteredGames : string[] = ["flagle", "kelma", "quordle", "wordle"];
  if (game) {
    filteredGames = [game];
  }
  let leaderboard = "";
  const today = new Date(
      new Date().toLocaleString("en-US", {timeZone: "Europe/Rome"}))
      .setUTCHours(0, 0, 0, 0);
  functions.logger.info(today,
      {structuredData: true});
  await db.collection("daily_highscore")
      .where("date", "==", today)
      .where("chat_id", "==", chatId)
      .orderBy("score", "asc")
      .get().then((snapshot) => {
        snapshot.forEach((doc) => {
          const newelement = {
            "username": doc.data().username,
            "game": doc.data().game,
            "score": doc.data().score,
          };
          orderedList.push(newelement);
        });
      }).catch((reason) => {
        throw reason;
      });
  functions.logger.info(orderedList,
      {structuredData: true});
  const groupedByGame = groupBy(orderedList, (highscore) => highscore.game);
  functions.logger.info(groupedByGame,
      {structuredData: true});
  leaderboard+="\n";
  const awards : {[key:number]:string} = {0: "🥇", 1: "🥈", 2: "🥉"};
  filteredGames.forEach((game:string) => {
    leaderboard+=game+"\n";
    groupedByGame[game] && groupedByGame[game].forEach((element, index) => {
      if (index < 3 ) {
        leaderboard += awards[index];
      }
      leaderboard += " @"+element.username + " with ";
      leaderboard += element.score + " points\n";
    });
    leaderboard+="\n";
  });
  return leaderboard;
};

export const updateLeaderboard = functions.firestore
    .document("daily_highscore/{highscore}")
    .onCreate(async (snap) => {
      const newValue = snap.data();
      const game = newValue.game;
      functions.logger.info(game);
      const id = newValue.chat_id;
      const leaderboard = await getLeaderboard(id, game);
      await axios
          .post(`${process.env.TELEGRAM_API}${process.env.A_TOKEN}/sendMessage`,
              {chat_id: parseInt(id), text: leaderboard})
          .then((res) => {
            return res.data.result;
          })
          .catch((error) => {
            return error;
          });
    });

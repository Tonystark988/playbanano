require("dotenv").config({ path: ".env" });
const config = require("./config.json");

const Database = require("simplest.db");
const Discord = require("discord.js");
const QRCode = require("qrcode");
const axios = require("axios");
const BigNumber = require("bignumber.js");
const schedule = require("node-schedule");
const randomNumber = require("random-number-csprng");

let commandCooldown = new Set();
let balanceCooldown = new Set();

let disabled = false;

const bananoUtils = require("./utils/bananoUtils.js");
const blackjack = require("./utils/blackjack.js");
const roulette = require("./utils/roulette.js");
const crash = require("./utils/crash.js");
const dbTools = require("./utils/dbTools.js");

const db_users = new Database({
    path: "./db/users.json"
});

const defaultEmbed = () => {
    return new Discord.MessageEmbed()
        .setColor(config["embed-color"])
        .setTimestamp()
        .setFooter({
            text: config["embed-footer-text"],
            iconURL: config["embed-footer-icon"]
        })
};

const generateRandom = async () => {
    let ret = await randomNumber(0, 100000);
    return ret / 100000;
};

let maxBet;

const updateMaxBet = async () => {
    if (process.env["APP_MODE"] == "TESTING") return maxBet = config["max-bet"];
    let maxBetTemp = 0;
    const housePublicKey = await bananoUtils.getPublicKey(0);
    let houseBalance = await bananoUtils.accountBalance(housePublicKey);
    maxBetTemp = Math.floor(BigNumber(houseBalance.balance).div(BigNumber("1e29")).times(config["max-bet-percentage"]).toNumber() * 1e2) / 1e2;
    maxBet = maxBetTemp > config["max-bet"] ? config["max-bet"] : maxBetTemp;
};

updateMaxBet();
setInterval(updateMaxBet, 30000);

const resetWeekly = schedule.scheduleJob('00 59 23 * * 0', function(){
    dbTools.resetWeekly();
    console.log("Weekly stats reset");
});

const client = new Discord.Client({
    intents: [
        Discord.Intents.FLAGS.GUILD_MESSAGES,
        Discord.Intents.FLAGS.GUILDS,
        Discord.Intents.FLAGS.DIRECT_MESSAGES,
        Discord.Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
        Discord.Intents.FLAGS.GUILD_MEMBERS
    ]
});

client.on("ready", () => {
    console.log("Logged in: " + client.user.tag);
})

client.on("messageCreate", async (message) => {

    if (disabled && !config["admin-users"].includes(message.author.id)) return;

    const myPermissions = message.guild.me.permissionsIn(message.channel).toArray();
    if (!(myPermissions.includes("VIEW_CHANNEL") && myPermissions.includes("SEND_MESSAGES") && myPermissions.includes("EMBED_LINKS"))) return;

    message.replyEmbed = (desc, color=config["embed-color"]) => {
        message.reply({ embeds: [ defaultEmbed().setDescription(desc).setColor(color) ] });
    };

    if (!message.content.toLowerCase().startsWith(config["prefix"])) return;
    const args = message.content.toLowerCase().substring(config["prefix"].length).split(" ");

    if (commandCooldown.has(message.author.id)) {
        return;
    } else {
        commandCooldown.add(message.author.id);
        setTimeout(() => commandCooldown.delete(message.author.id), config["command-cooldown"]);
    };

    console.log("< " + message.guild.name + " > [ " + (new Date()).toLocaleTimeString() + " ]", message.author.tag, args);

    if (["help"].includes(args[0])) {
        return message.reply({ embeds: [
            defaultEmbed().setTitle("Commands list")
            .addField("General", [
                `\`${config["prefix"]}balance\` - Check your balance`,
                `\`${config["prefix"]}deposit\` - Get your deposit address`,
                `\`${config["prefix"]}withdraw [amount] [address]\` - Withdraw [amount] to [address]`,
                `\`${config["prefix"]}send [amount] [@user]\` - Send [amount] BAN to [@user]`,
                `\`${config["prefix"]}donate [amount]\` - Donate [amount] to the house`,
                `\`${config["prefix"]}stats\` - Check your gambling stats`,
                `\`${config["prefix"]}leaderboard [wagered/won/lost]\` - Check user leaderboards`,
                `\`${config["prefix"]}house\` - Check casino information`,
            ].join(`\n`))
            .addField("Casino", [
                `\`${config["prefix"]}coinflip [amount] [heads/tails]\` - Bet [amount] BAN on a coinflip's outcome`,
                `\`${config["prefix"]}roulette [amount] [odd/even/low/high/red/black/#]\` - Bet [amount] BAN on a roulette's outcome`,
                `\`${config["prefix"]}blackjack [amount]\` - Start a game of blackjack`,
                `\`${config["prefix"]}crash [amount]\` - Start a game of crash, cash out before the rocket explodes!`
            ].join(`\n`))
        ]});
    }

    if (["balance", "bal", "wallet"].includes(args[0])) {
        let lookupUser = config["admin-users"].includes(message.author.id) ? (message.mentions.users.first() || message.author) : message.author;
        if (balanceCooldown.has(lookupUser.id)) return;
        balanceCooldown.add(lookupUser.id);
        const userPublicKey = await bananoUtils.getPublicKey(lookupUser.id);
        let accountBalance = await bananoUtils.accountBalance(userPublicKey);
        if (BigNumber(accountBalance.pending).isGreaterThan(BigNumber(0)) || BigNumber(accountBalance.balance).isGreaterThan(BigNumber(0))) {
            await bananoUtils.receivePending(lookupUser.id);
            if (!BigNumber(Math.floor(BigNumber(accountBalance.pending).plus(BigNumber(accountBalance.balance)).div(BigNumber("1e29")).toNumber() * 1e2) / 1e2).times(BigNumber("1e29")).isEqualTo(BigNumber(0))) {
                accountBalance = await bananoUtils.accountBalance(userPublicKey);
                console.log(accountBalance);
                if (accountBalance["balance"] != '0') {
                    await bananoUtils.sendBanID(0, accountBalance.balance, lookupUser.id);
                    await dbTools.addBalance(lookupUser.id, Math.floor(BigNumber(accountBalance.balance).div(BigNumber("1e29")).toNumber() * 1e2) / 1e2);
                    try {
                        await bananoUtils.receivePending(0);
                    } catch(err) {
                        console.error(err);
                    };
                    console.log(`Added ${(Math.floor(BigNumber(accountBalance.pending).plus(BigNumber(accountBalance.balance)).div(BigNumber("1e29")).toNumber() * 1e2) / 1e2).toFixed(2)} BAN to ${lookupUser.id}`);    
                };
            };
        };
        setTimeout(() => {
            balanceCooldown.delete(lookupUser.id);
        }, 5000);
        return message.reply({ embeds: [ defaultEmbed().setDescription(`${lookupUser.id == message.author.id ? "You have" : lookupUser + " has"} **${(Math.floor(dbTools.getUserInfo(lookupUser.id)["balance"] * 1e2) / 1e2).toFixed(2)} BAN**`) ] });
    }

    if (["stats", "info", "statistics", "lookup", "user"].includes(args[0])) {
        const userInfo = dbTools.getUserInfo(message.author.id);
        const userEmbed = defaultEmbed()
            .setTitle("User information")
            .addField("Balance", `${userInfo["balance"].toFixed(2)} BAN`)
            .addField("Total wagered", `${(userInfo["totalWagered"]).toFixed(2)} BAN`)
            .addField("Winnings", `+${userInfo["totalWon"].toFixed(2)} BAN`, true)
            .addField("Losses", `-${userInfo["totalLost"].toFixed(2)} BAN`, true)
            .addField("Net P/L", `${(userInfo["totalWon"] - userInfo["totalLost"]).toFixed(2)} BAN`, false)
        return message.reply({ embeds: [ userEmbed ] });
    }
    
    if (["leaderboard", "lb", "top"].includes(args[0])) {
        const lbType = args[1];
        if (!["wagered", "won", "lost", "balance", "event"].includes(lbType)) return message.replyEmbed(`Command syntax: \`${config["prefix"]}${args[0]} [wagered/won/lost]\``);

        let dbJSONraw = dbTools.getJSON();
        const lbEmbed = defaultEmbed()
            .setTitle(config["leaderboard-titles"][lbType])
        
        let dbJSON = [];
        Object.keys(dbJSONraw).forEach(uid => {
            dbJSONraw[uid]["uid"] = uid;
            dbJSON.push(dbJSONraw[uid]);
        });

        switch (lbType) {
            case "wagered":
                dbJSON = dbJSON.sort((a, b) => (b["totalWagered"]) - (a["totalWagered"]));
                for (let i = 0; i < (dbJSON.length < 10 ? dbJSON.length : 10); i++) {
                    let fetchedUser = client.users.cache.get(dbJSON[i]["uid"]);
                    lbEmbed.addField(`${i + 1}) ${fetchedUser ? fetchedUser.tag : "`" + dbJSON[i]["uid"] + "`"}`, `${(dbJSON[i]["totalWagered"]).toFixed(2)} BAN`);
                }
                break;
            case "event":
                dbJSON = dbJSON.sort((a, b) => (b["weeklyWagered"]) - (a["weeklyWagered"]));
                for (let i = 0; i < (dbJSON.length < 10 ? dbJSON.length : 10); i++) {
                    let fetchedUser = client.users.cache.get(dbJSON[i]["uid"]);
                    lbEmbed.addField(`${i + 1}) ${fetchedUser ? fetchedUser.tag : "`" + dbJSON[i]["uid"] + "`"}`, `${(dbJSON[i]["weeklyWagered"]).toFixed(2)} BAN`);
                }
                break;
            case "balance":
                dbJSON = dbJSON.sort((a, b) => b["balance"] - a["balance"]);
                for (let i = 0; i < (dbJSON.length < 10 ? dbJSON.length : 10); i++) {
                    let fetchedUser = client.users.cache.get(dbJSON[i]["uid"]);
                    lbEmbed.addField(`${i + 1}) ${fetchedUser ? fetchedUser.tag : "`" + dbJSON[i]["uid"] + "`"}`, `${dbJSON[i]["balance"].toFixed(2)} BAN`);
                }
                break;
            case "won":
                dbJSON = dbJSON.sort((a, b) => (b["totalWon"] - b["totalLost"]) - (a["totalWon"] - a["totalLost"]));
                for (let i = 0; i < (dbJSON.length < 10 ? dbJSON.length : 10); i++) {
                    let fetchedUser = client.users.cache.get(dbJSON[i]["uid"]);
                    lbEmbed.addField(`${i + 1}) ${fetchedUser ? fetchedUser.tag : "`" + dbJSON[i]["uid"] + "`"}`, `${(dbJSON[i]["totalWon"] - dbJSON[i]["totalLost"]).toFixed(2)} BAN`);
                }
                break;
            case "lost":
                dbJSON = dbJSON.sort((a, b) => (a["totalWon"] - a["totalLost"]) - (b["totalWon"] - b["totalLost"]));
                for (let i = 0; i < (dbJSON.length < 10 ? dbJSON.length : 10); i++) {
                    let fetchedUser = client.users.cache.get(dbJSON[i]["uid"]);
                    lbEmbed.addField(`${dbJSON.length - i}) ${fetchedUser ? fetchedUser.tag : "`" + dbJSON[i]["uid"] + "`"}`, `${(dbJSON[i]["totalWon"] - dbJSON[i]["totalLost"]).toFixed(2)} BAN`);
                }
                break;
        }

        return message.reply({ embeds: [ lbEmbed ] });
    }
    
    if (["house"].includes(args[0])) {
        const housePublicKey = await bananoUtils.getPublicKey(0);
        let houseBalance = await bananoUtils.accountBalance(housePublicKey);
        let dbTotalBalance = dbTools.totalBalance();
        return message.reply({ embeds: [
            defaultEmbed()
                .addField("Total user funds", `${dbTotalBalance.toFixed(2)} BAN`, true)
                .addField("House balance", `${(BigNumber(houseBalance.balance).div(BigNumber("1e29")) - dbTotalBalance).toFixed(2)} BAN`, true)
                .addField("Casino funds", `${BigNumber(houseBalance.balance).div(BigNumber("1e29")).toFixed(2)} BAN`, true)
                .addField("Minimum bet", `${config["min-bet"].toFixed(2)} BAN`, true)
                .addField("Maximum bet", `${maxBet.toFixed(2)} BAN`, true)
                // .addField("House edge", `${config["house-edge"] * 100}%`, true)
        ]});
    }

    if (["send"].includes(args[0])) {
        let payAmount = parseFloat(args[1]);
        let recvUser;
        if (message.type === "REPLY") {
            const ogMessage = await message.fetchReference();
            recvUser = ogMessage.author;
        } else { recvUser = message.mentions.users.first(); };
        if (!recvUser || !payAmount) return message.replyEmbed(`Command syntax: \`${config["prefix"]}${args[0]} [amount] [@user]\``);
        payAmount = Math.floor(payAmount * 1e2) / 1e2;
        if (payAmount < config["min-pay"]) return message.replyEmbed(`Minimum payment: **${config["min-pay"]} BAN**`);
        if (recvUser.id == message.author.id) return message.replyEmbed(`You can't tip yourself!`);
        if (dbTools.getUserInfo(message.author.id)["balance"] < payAmount) return message.replyEmbed("You don't have enough Banano to do that.");
        await dbTools.transferBalance(message.author.id, recvUser.id, payAmount);
        return message.replyEmbed(`Sent **${payAmount.toFixed(2)} BAN** to ${recvUser}`);
    }
    
    if (["donate"].includes(args[0])) {
        let payAmount = parseFloat(args[1]);
        if (!payAmount) return message.replyEmbed(`Command syntax: \`${config["prefix"]}${args[0]} [amount]\``);
        payAmount = Math.floor(payAmount * 1e2) / 1e2;
        if (payAmount < config["min-pay"]) return message.replyEmbed(`Minimum payment: **${config["min-pay"]} BAN**`);
        if (dbTools.getUserInfo(message.author.id)["balance"] < payAmount) return message.replyEmbed("You don't have enough Banano to do that.");
        await dbTools.addBalance(message.author.id, 0-payAmount);
        return message.replyEmbed(`Donated **${payAmount.toFixed(2)} BAN** to the house`);
    }

    if (["deposit"].includes(args[0])) {
        if (process.env["APP_MODE"] == "TESTING") return message.replyEmbed("Bot is in \`TESTING\` mode");
        const userPublicKey = await bananoUtils.getPublicKey(message.author.id);
        QRCode.toDataURL(userPublicKey, function (err, url) {
            const depositEmbed = defaultEmbed()
            .setDescription(`**${userPublicKey}**`)
            .setImage(`https://quickchart.io/qr?text=${userPublicKey}.png&dark=${config["qr-code-dark"].substring(1)}&light=${config["qr-code-light"].substring(1)}`)
            message.reply({ embeds: [depositEmbed] })
            if (process.env["APP_MODE"] == "TESTING") {
                message.replyEmbed("**NOTE: we are in the testing period, do not send BAN to the address above. <@293405833231073280> will give you 5 BAN to test with. Any extra sent to the address will be counted as a donation.**");
            } else {
                return message.channel.send(userPublicKey);
            }
        });
    }
    
    if (["withdraw"].includes(args[0])) {
        if (process.env["APP_MODE"] == "TESTING") return message.replyEmbed("Bot is in \`TESTING\` mode");
        let payAmount = parseFloat(args[1]);
        let withdrawAddress = args[2];
        if (!payAmount || !withdrawAddress) return message.replyEmbed(`Command syntax: \`${config["prefix"]}${args[0]} [amount] [address]\``);
        if (!withdrawAddress.startsWith("ban_")) return message.replyEmbed("Invalid BAN address");
        payAmount = Math.floor(payAmount * 1e2) / 1e2;
        if (payAmount < config["min-pay"]) return message.replyEmbed(`Minimum withdrawal: **${config["min-pay"]} BAN**`);
        if (dbTools.getUserInfo(message.author.id)["balance"] < payAmount) return message.replyEmbed("You don't have enough Banano to do that.");
        const housePublicKey = await bananoUtils.getPublicKey(0);
        let houseBalance = await bananoUtils.accountBalance(housePublicKey);
        if (BigNumber(payAmount).times(BigNumber("1e29")).isGreaterThan(houseBalance.balance)) return message.replyEmbed("An error occured. Try again later.");
        await dbTools.addBalance(message.author.id, 0-payAmount);
        let txHash = await bananoUtils.sendBan(withdrawAddress, BigNumber(payAmount).times(BigNumber("1e29")).toNumber());
        return message.replyEmbed(`Withdrawn **${payAmount.toFixed(2)} BAN** to ${withdrawAddress}\n\n\`${txHash}\`\nhttps://creeper.banano.cc/explorer/block/${txHash}`);
    }

    if (["add"].includes(args[0])) {
        if (!config["admin-users"].includes(message.author.id)) return message.replyEmbed("You lack permission to do that...");
        let payAmount;
        let recvUser;
        if (message.type === "REPLY") {
            const ogMessage = await message.fetchReference();
            recvUser = ogMessage.author;
            payAmount = parseFloat(args[1]);
        } else {
            payAmount = parseFloat(args[1]);
            recvUser = message.mentions.users.first();
        };
        if (!recvUser || !payAmount) return message.replyEmbed(`Command syntax: \`${config["prefix"]}${args[0]} [amount] [@user]\``);
        payAmount = Math.floor(payAmount * 1e2) / 1e2;
        await dbTools.addBalance(recvUser.id, payAmount);
        return message.replyEmbed(`Sent **${payAmount.toFixed(2)} BAN** to ${recvUser}`);
    }
    
    if (["disable", "enable"].includes(args[0])) {
        if (!config["admin-users"].includes(message.author.id)) return message.replyEmbed("You lack permission to do that...");
        disabled = !disabled;
        return message.replyEmbed(`Commands are now **${disabled ? "disabled" : "enabled"}**.`);
    }

    if (["forcetransact", "ft"].includes(args[0])) {
        if (!config["admin-users"].includes(message.author.id)) return message.replyEmbed("You lack permission to do that...");
        let payAmount = parseFloat(args[1]);
        const senderID = args[2];
        const recvID = args[3];
        if (!payAmount || senderID == undefined || recvID == undefined) return message.replyEmbed(`Command syntax: \`${config["prefix"]}${args[0]} [amount] [senderID] [recvID]\``);
        payAmount = Math.floor(payAmount * 1e2) / 1e2;
        if (payAmount < config["min-pay"]) return message.replyEmbed(`Minimum payment: **${config["min-pay"]} BAN**`);
        await dbTools.transferBalance(senderID, recvID, payAmount);
        message.replyEmbed(`**${payAmount.toFixed(2)} BAN** moved from \`${senderID} => ${recvID}\``);
    }

    if (["coinflip", "cf", "coin", "flip"].includes(args[0])) {
        if (maxBet < config["min-bet"]) return message.replyEmbed(`Betting is currently disabled.`);
        let betAmount = parseFloat(args[1]);
        let betOn = ["heads", "tails", "h", "t"].includes(args[2]) ? args[2] : false;
        if (!betAmount || !betOn) return message.replyEmbed(`Command syntax: \`${config["prefix"]}${args[0]} [amount] [heads/tails]\``);
        betAmount = Math.floor(betAmount * 1e2) / 1e2;
        if (betAmount < config["min-bet"]) return message.replyEmbed(`Minimum bet: **${config["min-bet"]} BAN**`);
        if (betAmount > maxBet) return message.replyEmbed(`Maximum bet: **${maxBet} BAN**`);
        if (betOn == "h") betOn = "heads";
        if (betOn == "t") betOn = "tails";
        if (dbTools.getUserInfo(message.author.id)["balance"] < betAmount) return message.replyEmbed("You don't have enough Banano to do that.");
        await dbTools.addWagered(message.author.id, betAmount);
        let ranGen = await generateRandom();
        if (ranGen >= (0.5 * (1+config["house-edge"]))) {
            await dbTools.addWon(message.author.id, betAmount);
            await dbTools.addBalance(message.author.id, betAmount);
            return message.replyEmbed(`The coin landed on ${betOn} - congrats!\n**+${betAmount.toFixed(2)} BAN**`, config["embed-color-win"]);
        } else {
            await dbTools.addLost(message.author.id, betAmount);
            await dbTools.addBalance(message.author.id, 0-betAmount);
            return message.replyEmbed(`The coin landed on ${betOn == "heads" ? "tails" : "heads"}...\n**-${betAmount.toFixed(2)} BAN**`, config["embed-color-loss"]);
        }
    }

    if (["roulette", "roul", "r"].includes(args[0])) {
        if (maxBet < config["min-bet"]) return message.replyEmbed(`Betting is currently disabled.`);
        let betAmount = parseFloat(args[1]);
        let betOn = false;
        if (parseInt(args[2]) && (parseInt(args[2]) == args[2]) && (parseInt(args[2]) > 0 && parseInt(args[2]) <= 36)) betOn = parseInt(args[2]);
        if (["odd", "even", "low", "high", "red", "black"].includes(args[2])) betOn = args[2];
        if (!betAmount || !betOn) return message.replyEmbed(`Command syntax: \`${config["prefix"]}${args[0]} [amount] [odd/even/low/high/red/black/1-36]\``);
        betAmount = Math.floor(betAmount * 1e2) / 1e2;
        if (betAmount < config["min-bet"]) return message.replyEmbed(`Minimum bet: **${config["min-bet"]} BAN**`);
        if (betAmount > maxBet) return message.replyEmbed(`Maximum bet: **${maxBet} BAN**`);
        if (dbTools.getUserInfo(message.author.id)["balance"] < betAmount) return message.replyEmbed("You don't have enough Banano to do that.");
        await dbTools.addBalance(message.author.id, 0-betAmount);
        await dbTools.addWagered(message.author.id, betAmount);
        const rouletteResult = await roulette.getOutcome(betOn, betAmount);
        if (rouletteResult["bet"]["win"] && rouletteResult["roll"]["number"] != 0) {
            await dbTools.addWon(message.author.id, parseFloat(rouletteResult["bet"]["payout"]) - betAmount);
            await dbTools.addBalance(message.author.id, parseFloat(rouletteResult["bet"]["payout"]));
            message.replyEmbed(`The wheel landed on a **:${rouletteResult["roll"]["color"].toLowerCase()}_circle: ${rouletteResult["roll"]["number"]}**\n\nCongrats, you won!\n**+${(parseFloat(rouletteResult["bet"]["payout"]) - betAmount).toFixed(2)} BAN**`, config["embed-color-win"]);
        } else {
            await dbTools.addLost(message.author.id, betAmount);
            message.replyEmbed(`The wheel landed on a **:${rouletteResult["roll"]["color"].toLowerCase()}_circle: ${rouletteResult["roll"]["number"]}**\n\nYou lost...\n**-${betAmount.toFixed(2)} BAN**`, config["embed-color-loss"]);
        }
    }
    
    if (["blackjack", "bj"].includes(args[0])) {
        if (maxBet < config["min-bet"]) return message.replyEmbed(`Betting is currently disabled.`);
        let betAmount = parseFloat(args[1]);
        if (!betAmount) return message.replyEmbed(`Command syntax: \`${config["prefix"]}${args[0]} [amount]\``);
        betAmount = Math.floor(betAmount * 1e2) / 1e2;
        if (betAmount < config["min-bet"]) return message.replyEmbed(`Minimum bet: **${config["min-bet"]} BAN**`);
        if (betAmount > maxBet) return message.replyEmbed(`Maximum bet: **${maxBet} BAN**`);
        if (dbTools.getUserInfo(message.author.id)["balance"] < betAmount) return message.replyEmbed("You don't have enough Banano to do that.");
        await dbTools.addBalance(message.author.id, 0-betAmount);
        await dbTools.addWagered(message.author.id, betAmount);
        
        let game = blackjack.startGame();
        let gameMsg = await message.reply({ embeds: [ defaultEmbed().setDescription({
            "ONGOING": `React with a 👊 to hit or a 🛑 to stand.`,
            "PLAYER_WIN": `You won **${betAmount.toFixed(2)} BAN**!`,
            "DEALER_WIN": `You lost **${betAmount.toFixed(2)} BAN**...`,
            "PUSH": `You drew and got back your money.`
        }[game.result]).addField("Dealer", [
            `${game.dealer.hand.map(c => config["card-emojis"]["ranks"][["spades", "clubs"].includes(c[1]) ? "black" : "red"][c[0]]).join("")}`,
            `${game.dealer.hand.map(c => config["card-emojis"]["suits"][c[1]]).join("")} = ${game.dealer.value}`,
        ].join(`\n`)).addField("Player", [
            `${game.player.hand.map(c => config["card-emojis"]["ranks"][["spades", "clubs"].includes(c[1]) ? "black" : "red"][c[0]]).join("")}`,
            `${game.player.hand.map(c => config["card-emojis"]["suits"][c[1]]).join("")} = ${game.player.value}`,
        ].join(`\n`)).setColor({
            "ONGOING": config["embed-color"],
            "PLAYER_WIN": config["embed-color-win"],
            "DEALER_WIN": config["embed-color-loss"],
            "PUSH": config["embed-color-draw"]
        }[game.result]) ] });
        
        function awaitNextTurn() {

            gameMsg.awaitReactions({
                filter: (reaction, user) => (user.id == message.author.id) && (["👊", "🛑"].includes(reaction.emoji.name)),
                max: 1,
                time: 60000
            }).then(async (collected) => {

                if (collected.first().emoji.name == "👊") { game = blackjack.hit(game); }
                else { game = blackjack.stand(game); };

                try { await collected.first().users.remove(message.author.id); } catch(err) { console.error(err); };

                gameMsg.edit({ embeds: [ defaultEmbed().setDescription({
                    "ONGOING": `React with a 👊 to hit or a 🛑 to stand.`,
                    "PLAYER_WIN": `You won **${betAmount.toFixed(2)} BAN**!`,
                    "DEALER_WIN": `You lost **${betAmount.toFixed(2)} BAN**...`,
                    "PUSH": `You drew and got back your money.`
                }[game.result]).addField("Dealer", [
                    `${game.dealer.hand.map(c => config["card-emojis"]["ranks"][["spades", "clubs"].includes(c[1]) ? "black" : "red"][c[0]]).join("")}`,
                    `${game.dealer.hand.map(c => config["card-emojis"]["suits"][c[1]]).join("")} = ${game.dealer.value}`,
                ].join(`\n`)).addField("Player", [
                    `${game.player.hand.map(c => config["card-emojis"]["ranks"][["spades", "clubs"].includes(c[1]) ? "black" : "red"][c[0]]).join("")}`,
                    `${game.player.hand.map(c => config["card-emojis"]["suits"][c[1]]).join("")} = ${game.player.value}`,
                ].join(`\n`)).setColor({
                    "ONGOING": config["embed-color"],
                    "PLAYER_WIN": config["embed-color-win"],
                    "DEALER_WIN": config["embed-color-loss"],
                    "PUSH": config["embed-color-draw"]
                }[game.result]) ] });
    
                if (game.result == "ONGOING") { awaitNextTurn(); } else { endGame(); };

            }).catch((err) => {
                console.error(err);
                gameMsg.edit({ embeds: [ defaultEmbed().setDescription("Game expired. Bet lost.").setColor(config["embed-color-loss"]) ] });
            });

        };

        async function endGame() {

            try { await gameMsg.reactions.removeAll() } catch(err) { console.error(err) };

            switch (game.result) {
                case "PLAYER_WIN":
                    dbTools.addWon(message.author.id, betAmount);
                    dbTools.addBalance(message.author.id, betAmount*2);
                    break;
                case "DEALER_WIN":
                    dbTools.addLost(message.author.id, betAmount);
                    break;
                case "PUSH":
                    dbTools.addBalance(message.author.id, betAmount);
                    break;
            };

        };

        if (game.player.value == 21) {
            endGame();
        } else {
            try {
                await gameMsg.react("👊");
                await gameMsg.react("🛑");
                awaitNextTurn();
            } catch (err) {
                console.error(err);
                gameMsg.edit({ embeds: [ defaultEmbed().setDescription("This game is disabled in this server.").setColor(config["embed-color-loss"]) ] });
            };
        };

    }

    if (["crash"].includes(args[0])) {

        if (maxBet < config["min-bet"]) return message.replyEmbed(`Betting is currently disabled.`);
        let betAmount = parseFloat(args[1]);
        if (!betAmount) return message.replyEmbed(`Command syntax: \`${config["prefix"]}${args[0]} [amount]\``);
        betAmount = Math.floor(betAmount * 1e2) / 1e2;
        if (betAmount < config["min-bet"]) return message.replyEmbed(`Minimum bet: **${config["min-bet"]} BAN**`);
        if (betAmount > maxBet) return message.replyEmbed(`Maximum bet: **${maxBet} BAN**`);
        if (dbTools.getUserInfo(message.author.id)["balance"] < betAmount) return message.replyEmbed("You don't have enough Banano to do that.");
        await dbTools.addBalance(message.author.id, 0-betAmount);
        await dbTools.addWagered(message.author.id, betAmount);

        let multiplier = crash.generateMultiplier();
        let displayMultiplier = 0;
        let cashedOut = false;
        // multiplier = 1.2**secs
        // secs = log(multiplier) / log(1.2)
        let duration = Math.log(multiplier) / Math.log(1.2);
        
        let crashMsg = await message.reply({ embeds: [ defaultEmbed().setTitle(`1.00x 🚀`).setDescription(`React with 💰 to secure your profits!`).addField(`Profit`, `0.00 BAN`) ] });
        for (let i = 1; i < Math.ceil(duration); i++) {
            setTimeout(() => {
                if (!cashedOut) {
                    displayMultiplier = parseFloat((1.2**i).toFixed(2));
                    crashMsg.edit({ embeds: [ defaultEmbed().setTitle(`${displayMultiplier.toFixed(2)}x 🚀`).setDescription(`React with 💰 to secure your profits!`).addField(`Profit`, `+${(betAmount * (displayMultiplier - 1)).toFixed(2)} BAN`) ] });
                };
            }, i*1500);
        };

        function awaitInput() {
            crashMsg.awaitReactions({
                filter: (reaction, user) => (user.id == message.author.id) && (["💰"].includes(reaction.emoji.name)),
                max: 1,
                time: Math.ceil(duration) * 1500
            }).then(async (collected) => {

                if (!collected.first()) {
                    crashMsg.edit({ embeds: [ defaultEmbed().setTitle(`${displayMultiplier.toFixed(2)}x 💥`).addField(`Profit`, `${(-betAmount).toFixed(2)} BAN`).setColor(config["embed-color-loss"]) ] });
                    dbTools.addLost(message.author.id, betAmount);
                    try { await crashMsg.reactions.removeAll() } catch(err) { console.error(err) };
                } else {
                    cashedOut = true;
                    crashMsg.edit({ embeds: [ defaultEmbed().setTitle(`${displayMultiplier.toFixed(2)}x 💰`).addField(`Profit`, `+${(betAmount * (displayMultiplier - 1)).toFixed(2)} BAN`).setColor(config["embed-color-win"]) ] });
                    await dbTools.addBalance(message.author.id, betAmount * displayMultiplier);
                    await dbTools.addWon(message.author.id, betAmount * (displayMultiplier - 1));
                    try { await crashMsg.reactions.removeAll() } catch(err) { console.error(err) };
                };

            }).catch(async (err) => {
                console.error(err);
                try { await crashMsg.reactions.removeAll() } catch(err) { console.error(err) };
                crashMsg.edit({ embeds: [ defaultEmbed().setDescription("This game is disabled in this server.").setColor(config["embed-color-loss"]) ] });
            });
        };

        try {
            await crashMsg.react("💰");
            awaitInput();
        } catch (err) {
            console.error(err);
            crashMsg.edit({ embeds: [ defaultEmbed().setDescription("This game is disabled in this server.").setColor(config["embed-color-loss"]) ] });
        };

    }
    
})

client.login(process.env["BOT_TOKEN"]);
require("dotenv").config({ path: ".env" });
const config = require("./config.json");

const Database = require("simplest.db");
const Discord = require("discord.js");
const QRCode = require("qrcode");
const axios = require("axios");
const BigNumber = require("bignumber.js");
const randomNumber = require("random-number-csprng");

let commandCooldown = new Set();
let balanceCooldown = new Set();

const bananoUtils = require("./utils/bananoUtils.js");
const blackjack = require("./utils/blackjack.js");
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

    message.replyEmbed = (desc) => {
        message.reply({ embeds: [ defaultEmbed().setDescription(desc) ] });
    };

    if (!message.content.toLowerCase().startsWith(config["prefix"])) return;
    const args = message.content.toLowerCase().substring(config["prefix"].length).split(" ");

    if (commandCooldown.has(message.author.id)) {
        return;
    } else {
        commandCooldown.add(message.author.id);
        setTimeout(() => commandCooldown.delete(message.author.id), config["command-cooldown"]);
    };

    console.log("[ " + (new Date()).toLocaleTimeString() + " ]", message.author.tag, args);

    if (["help"].includes(args[0])) {
        return message.reply({ embeds: [
            defaultEmbed().setTitle("Commands list").setDescription([
                `\`${config["prefix"]}balance\` - Check your balance`,
                `\`${config["prefix"]}deposit\` - Get your deposit address`,
                `\`${config["prefix"]}withdraw [amount] [address]\` - Withdraw [amount] to [address]`,
                `\`${config["prefix"]}send [amount] [@user]\` - Send [amount] BAN to [@user]`,
                `\`${config["prefix"]}coinflip [amount] [heads/tails]\` - Bet [amount] BAN on a coinflip's outcome`,
                `\`${config["prefix"]}roulette [amount] [odd/even/low/high/red/black/#]\` - Bet [amount] BAN on a roulette's outcome`,
                `\`${config["prefix"]}blackjack [amount]\` - Start a game of blackjack`,
                ``,
                `*Minimum bet:* \`${config["min-bet"]} BAN\``,
                `*Minimum payment/withdrawal:* \`${config["min-pay"]} BAN\``,
                `*House edge:* \`${config["house-edge"] * 100}%\``
            ].join(`\n`))
        ]});
    }

    if (["balance", "bal", "wallet"].includes(args[0])) {
        let lookupUser = message.mentions.users.first() || message.author;
        if (balanceCooldown.has(lookupUser.id)) return;
        balanceCooldown.add(lookupUser.id);
        const userPublicKey = await bananoUtils.getPublicKey(lookupUser.id);
        let accountBalance = await bananoUtils.accountBalance(userPublicKey);
        if (BigNumber(accountBalance.pending).isGreaterThan(BigNumber(0)) || BigNumber(accountBalance.balance).isGreaterThan(BigNumber(0))) {
            await bananoUtils.receivePending(lookupUser.id);
            if (!BigNumber(Math.floor(BigNumber(accountBalance.pending).plus(BigNumber(accountBalance.balance)).div(BigNumber("1e29")).toNumber() * 1e2) / 1e2).times(BigNumber("1e29")).isEqualTo(BigNumber(0))) {
                accountBalance = await bananoUtils.accountBalance(userPublicKey);
                console.log(accountBalance);
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
            .addField("Total wagered", `${userInfo["totalWagered"].toFixed(2)} BAN`)
            .addField("Winnings", `+${userInfo["totalWon"].toFixed(2)} BAN`, true)
            .addField("Losses", `-${userInfo["totalLost"].toFixed(2)} BAN`, true)
        return message.reply({ embeds: [ userEmbed ] });
    }
    
    if (["leaderboard", "lb", "top"].includes(args[0])) {
        const lbType = args[1];
        if (!["wagered", "won", "lost"].includes(lbType)) return message.replyEmbed(`Command syntax: \`${config["prefix"]}${args[0]} [wagered/won/lost]\``);
        let dbJSONraw = dbTools.getJSON();
        const lbEmbed = defaultEmbed()
            .setTitle("Leaderboard | Total wagered")
            // .addField("Losses", `-${userInfo["totalLost"].toFixed(2)} BAN`, true)
        
        let dbJSON = [];
        Object.keys(dbJSONraw).forEach(uid => {
            dbJSONraw[uid]["uid"] = uid;
            dbJSON.push(dbJSONraw[uid]);
        });

        switch (lbType) {
            case "wagered":
                dbJSON = dbJSON.sort((a, b) => b["totalWagered"] - a["totalWagered"]);
                for (let i = 0; i < (dbJSON.length < 10 ? dbJSON.length : 10); i++) {
                    let fetchedUser = client.users.cache.get(dbJSON[i]["uid"]);
                    lbEmbed.addField(`${i + 1}) ${fetchedUser ? fetchedUser.tag : "`" + dbJSON[i]["uid"] + "`"}`, `${dbJSON[i]["totalWagered"].toFixed(2)} BAN`);
                }
                break;
            case "won":
                dbJSON = dbJSON.sort((a, b) => b["totalWon"] - a["totalWon"]);
                for (let i = 0; i < (dbJSON.length < 10 ? dbJSON.length : 10); i++) {
                    let fetchedUser = client.users.cache.get(dbJSON[i]["uid"]);
                    lbEmbed.addField(`${i + 1}) ${fetchedUser ? fetchedUser.tag : "`" + dbJSON[i]["uid"] + "`"}`, `${dbJSON[i]["totalWon"].toFixed(2)} BAN`);
                }
                break;
            case "lost":
                dbJSON = dbJSON.sort((a, b) => b["totalLost"] - a["totalLost"]);
                for (let i = 0; i < (dbJSON.length < 10 ? dbJSON.length : 10); i++) {
                    let fetchedUser = client.users.cache.get(dbJSON[i]["uid"]);
                    lbEmbed.addField(`${i + 1}) ${fetchedUser ? fetchedUser.tag : "`" + dbJSON[i]["uid"] + "`"}`, `${dbJSON[i]["totalLost"].toFixed(2)} BAN`);
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
                .addField("Casino funds", `${BigNumber(houseBalance.balance).div(BigNumber("1e29")).toFixed(2)} BAN`)
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
        if (payAmount < config["min-bet"]) return message.replyEmbed(`Minimum payment: **${config["min-pay"]} BAN**`);
        if (recvUser.id == message.author.id) return message.replyEmbed(`You can't tip yourself!`);
        if (dbTools.getUserInfo(message.author.id)["balance"] < payAmount) return message.replyEmbed("You don't have enough Banano to do that.");
        await dbTools.transferBalance(message.author.id, recvUser.id, payAmount);
        return message.replyEmbed(`Sent **${payAmount.toFixed(2)} BAN** to ${recvUser}`);
    }

    if (["deposit"].includes(args[0])) {
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
        if (payAmount < config["min-bet"]) return message.replyEmbed(`Minimum withdrawal: **${config["min-pay"]} BAN**`);
        if (dbTools.getUserInfo(message.author.id)["balance"] < payAmount) return message.replyEmbed("You don't have enough Banano to do that.");
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
        let betAmount = parseFloat(args[1]);
        let betOn = ["heads", "tails", "h", "t"].includes(args[2]) ? args[2] : false;
        if (!betAmount || !betOn) return message.replyEmbed(`Command syntax: \`${config["prefix"]}${args[0]} [amount] [heads/tails]\``);
        betAmount = Math.floor(betAmount * 1e2) / 1e2;
        if (betAmount < config["min-bet"]) return message.replyEmbed(`Minimum bet: **${config["min-bet"]} BAN**`);
        if (betOn == "h") betOn = "heads";
        if (betOn == "t") betOn = "tails";
        if (dbTools.getUserInfo(message.author.id)["balance"] < betAmount) return message.replyEmbed("You don't have enough Banano to do that.");
        await dbTools.addWagered(message.author.id, betAmount);
        let ranGen = await generateRandom();
        if (ranGen >= (0.5 * (1+config["house-edge"]))) {
            await dbTools.addWon(message.author.id, betAmount);
            await dbTools.addBalance(message.author.id, betAmount);
            return message.replyEmbed(`The coin landed on ${betOn} - congrats!\n**+${betAmount.toFixed(2)} BAN**`);
        } else {
            await dbTools.addLost(message.author.id, betAmount);
            await dbTools.addBalance(message.author.id, 0-betAmount);
            return message.replyEmbed(`The coin landed on ${betOn == "heads" ? "tails" : "heads"}...\n**-${betAmount.toFixed(2)} BAN**`);
        }
    }

    if (["roulette", "roul"].includes(args[0])) {
        let betAmount = parseFloat(args[1]);
        let betOn = (["odd", "even", "low", "high", "red", "black"].includes(args[2]) || (parseInt(args[2]) && parseInt(args[2]) >= 0 && parseInt(args[2]) <= 36)) ? args[2] : false;
        if (!betAmount || !betOn) return message.replyEmbed(`Command syntax: \`${config["prefix"]}${args[0]} [amount] [odd/even/low/high/red/black/#]\``);
        betAmount = Math.floor(betAmount * 1e2) / 1e2;
        if (betAmount < config["min-bet"]) return message.replyEmbed(`Minimum bet: **${config["min-bet"]} BAN**`);
        if (dbTools.getUserInfo(message.author.id)["balance"] < betAmount) return message.replyEmbed("You don't have enough Banano to do that.");
        await dbTools.addWagered(message.author.id, betAmount);
        await dbTools.addBalance(message.author.id, 0-betAmount);
        await axios.get(`https://www.roulette.rip/api/play?bet=${betOn}&wager=${betAmount.toFixed(2)}`)
        .then(async rouletteResult => {
            if (rouletteResult.data["bet"]["win"] && rouletteResult.data["roll"]["number"] != 0) {
                    await dbTools.addWon(message.author.id, parseFloat(rouletteResult.data["bet"]["payout"]) - betAmount);
                    await dbTools.addBalance(message.author.id, parseFloat(rouletteResult.data["bet"]["payout"]));
                    message.replyEmbed(`The wheel landed on a **:${rouletteResult.data["roll"]["color"].toLowerCase()}_circle: ${rouletteResult.data["roll"]["number"]}**\n\nCongrats, you won!\n**+${(parseFloat(rouletteResult.data["bet"]["payout"]) - betAmount).toFixed(2)} BAN**`);
                } else {
                    await dbTools.addLost(message.author.id, betAmount);
                    message.replyEmbed(`The wheel landed on a **:${rouletteResult.data["roll"]["color"].toLowerCase()}_circle: ${rouletteResult.data["roll"]["number"]}**\n\nYou lost...\n**-${betAmount.toFixed(2)} BAN**`);
                }
            }).catch(console.error);
    }

    if (["blackjack", "bj"].includes(args[0])) {

        return message.replyEmbed("Command is down for maintenance.");

        let betAmount = parseFloat(args[1]);
        if (!betAmount) return message.replyEmbed(`Command syntax: \`${config["prefix"]}${args[0]} [amount]\``)
        betAmount = Math.floor(betAmount * 1e2) / 1e2;

        if (betAmount < config["min-bet"]) return message.replyEmbed(`Minimum bet: **${config["min-bet"]} BAN**`);

        if (dbTools.getUserInfo(message.author.id)["balance"] < betAmount) return message.replyEmbed("You don't have enough Banano to do that.");

        await dbTools.addBalance(message.author.id, 0-betAmount);
        
        let gameObject = blackjack.startGame();

        let gameMsg = await message.reply({
            embeds: [
                new Discord.MessageEmbed().setDescription(blackjack.generateEmbedDesc(gameObject, false)).setThumbnail(`https://imgur.com/dkoXQzs.png`)
            ]
        });
        
        const filter = (reaction, user) => {
            return [`🟢`, `🔴`].includes(reaction.emoji.name) && user.id == message.author.id;
        };

        await gameMsg.react(`🟢`);
        await gameMsg.react(`🔴`);

        let finishedLoop = false;

        while (finishedLoop == false) {

            await gameMsg.awaitReactions({ filter, max: 1, time: 60000, errors: ['time'] })
                .then(async collected => {
        
                    const reaction = collected.first();

                    let gameEmbed = new Discord.MessageEmbed().setThumbnail(`https://imgur.com/dkoXQzs.png`);

                    reaction.users.remove(message.author.id);
        
                    if (reaction.emoji.name === `🟢`) {
                        // hit
                        gameObject = blackjack.playerHit(gameObject);
                        gameEmbed.setDescription(blackjack.generateEmbedDesc(gameObject, false));
                        if (blackjack.calculateValue(gameObject.playerHand) >= 21) {
                        // if (blackjack.calculateValue(gameObject.dealerHand) >= 21 || blackjack.calculateValue(gameObject.playerHand) >= 21) {
                            gameEmbed.setDescription(blackjack.generateEmbedDesc(gameObject, true, betAmount));
                            let didPlayerWin = blackjack.playerWin(blackjack.calculateValue(gameObject.playerHand), blackjack.calculateValue(gameObject.dealerHand));    
                            if (didPlayerWin == 1) { await dbTools.addBalance(message.author.id, betAmount * 2); } 
                            else if (didPlayerWin == 0) { await dbTools.addBalance(message.author.id, betAmount); }
                            else { /* player lost */ }
                            finishedLoop = true;
                            gameMsg.reactions.removeAll();
                        }
                    } else {
                        // stand
                        gameObject = blackjack.playerStand(gameObject);
                        gameEmbed.setDescription(blackjack.generateEmbedDesc(gameObject, true, betAmount));
                        let didPlayerWin = blackjack.playerWin(blackjack.calculateValue(gameObject.playerHand), blackjack.calculateValue(gameObject.dealerHand));    
                        if (didPlayerWin == 1) { await dbTools.addBalance(message.author.id, betAmount * 2); } 
                        else if (didPlayerWin == 0) { await dbTools.addBalance(message.author.id, betAmount); }
                        else { /* player lost */ }
                        finishedLoop = true;
                        gameMsg.reactions.removeAll();
                    }
        
                    await gameMsg.edit({ embeds: [ gameEmbed ] })
        
                })
                .catch(async collected => {
                    let gameEmbed = new Discord.MessageEmbed().setDescription(`⏰ You took too long to react and lost your bet.`);
                    await gameMsg.edit({ embeds: [ gameEmbed ] })
                });

        };

    }

})

client.login(process.env["BOT_TOKEN"]);
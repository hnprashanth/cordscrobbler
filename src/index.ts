import * as Discord from 'discord.js';
import * as dotenv from 'dotenv';
import * as firebaseAdmin from 'firebase-admin';

import fs from 'fs';

import { DataProvidingService } from './data-providing-service';
import { UsersService } from './users-service';

import { parseTrack } from './track-parser';
import { returnExpectedCommandUsage, returnUserFriendlyErrorMessage } from './error-handling';
import { DatabaseService } from './database-service';

console.log('Configuring environment variables...')
dotenv.config();

console.log('Connecting to Firebase...')
firebaseAdmin.initializeApp({
    credential: firebaseAdmin.credential.cert(JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf-8'))),
    databaseURL: 'https://discord2lastfm.firebaseio.com'
});

const client = new Discord.Client();
const dataProvidingService = new DataProvidingService();
const databaseService = new DatabaseService(firebaseAdmin.firestore());
const usersService = new UsersService(databaseService);

const commands = new Discord.Collection<string, any>();
const commandsFolder = __dirname + '/commands';
const commandFiles = fs.readdirSync(commandsFolder).filter(file => file.endsWith('.js') || file.endsWith('.ts'));

for (const file of commandFiles) {
    const command = require(`${commandsFolder}/${file}`);
	commands.set(command.data.name, command);
}

client.once('ready', () => {
    console.log(`Bot ready. Connected to Discord as ${client.user.tag}.`);
});

client.on('message', async (message) => {
    if ((message.channel instanceof Discord.DMChannel || message.channel instanceof Discord.TextChannel) &&
        !message.author.bot &&
        message.content.startsWith(process.env.DISCORD_BOT_PREFIX)) {
        
        const args: string[] = message.content.slice(process.env.DISCORD_BOT_PREFIX.length).split(/ +/);
        const commandName = args.shift().toLowerCase();
        const command = commands.get(commandName) ??
                    commands.find(cmd => cmd.data.aliases && cmd.data.aliases.includes(commandName));

        if (!command) {
            message.reply(`I didn't recognize this command. You can see all the available commands by sending **${process.env.DISCORD_BOT_PREFIX}help**.`);
            return;
        }

        if (command.data.args && args.length === 0) {
            returnExpectedCommandUsage(commandName, command.data.usage, message);
            return;
        }

        try {
            await command.execute(message, args, usersService, client);
        } catch (error) {
            returnUserFriendlyErrorMessage(error, message, usersService, client);
        }

        // TODO: See registered users for a given guild
        // TODO: Change user options
    }

    if (message.channel instanceof Discord.TextChannel && message.author.bot) {
        const playbackData = dataProvidingService.lookForPlaybackData(message);
        if (playbackData) {
            console.log(playbackData);
            const track = parseTrack(playbackData);
            console.log(track);
            usersService.addToScrobbleQueue(track, playbackData);
        }
    }

});

console.log('Retrieving data from database...');
usersService.retrieveAllRegisteredUsersFromDatabase().then(() => {
    console.log('Connecting to Discord...');
    client.login(process.env.DISCORD_TOKEN);
})

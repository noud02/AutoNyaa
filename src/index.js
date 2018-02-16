#!/usr/bin/env node

const fs = require('fs');
const got = require('got');
const argv = require('yargs').argv;
const xml2js = require('xml2js');
const numeral = require('numeral');
const bluebird = require('bluebird');
const WebTorrent = require('webtorrent');

global.Promise = bluebird;
bluebird.promisifyAll(xml2js);

const client = new WebTorrent();
let i = 0;

async function next() {
    // If i is the length of all show arguments we gave it we're done
    if (i === argv._.length) {
        console.log('\nDone downloading all shows!');
        return process.exit();
    }

    const anime = argv._[i];

    // Get the RSS feed from nyaa.si, use user if specified (--user 'myUser')
    const res = await got(`https://nyaa.si/?page=rss&q=${escape(anime)}&u=${argv.user || 'HorribleSubs'}`);

    // convert the XML to JSON
    const json = await xml2js.parseStringAsync(res.body);

    // Filter and sort the results, only pick from specified res
    const items = json.rss.channel[0].item
        .filter(item => item.title[0].indexOf(argv.res || '1080p') > -1)
        .sort((one, two) => one.title[0].split(' - ')[1].split(' ')[0] > two.title[0].split(' - ')[1].split(' ')[0]);

    // If there aren't any matching results, skip this anime
    if (items.length === 0) {
        console.log(`\nNothing found for ${anime}!`);
        i++;
        return next();
    }

    let ii = 0;

    async function nextItem() {
        // If we're through all episodes go to the next show
        if (ii === items.length) {
            console.log('\nDone downloading show!');
            i++;
            return next();
        }

        const item = items[ii];

        // Add ep torrent to client
        client.add(item.link[0], torrent => {
            // the first file
            const file = torrent.files.find(file => file.name.endsWith('.mkv')); // TODO: add support for multiple files and other file types

            // Get file metadata
            const ep = Number(file.name.split(' - ')[1].split(' ')[0]);
            const title = file.name.split('] ')[1].split(' - ')[0];

            console.log(`\nDownloading ${title}`);

            // When there's new data update the progress
            torrent.on('download', _ => {
                if (torrent.downloaded >= file.length) {
                    if (torrent.downloaded > file.length) {
                        return console.log('\nThere *may* be additional files in this torrent, please wait until it\'s finished!')
                    } else {
                        return
                    }
                }

                process.stdout.cursorTo(1);
                process.stdout.write(`\x1B[?25lEP${ep} ${numeral(torrent.downloaded).format('0b')}/${numeral(torrent.length || file.length).format('0b')} [${numeral(torrent.downloadSpeed).format('0b')}/s]`);
                process.stdout.clearLine(1);
            });

            // If there's an error log it, warnings only with --debug flag
            torrent.on('error', err => console.error(`\nError: ${err}`));
            torrent.on('warning', warn => argv.debug && console.error(`\nWarning: ${warn}`));

            // When the torrent is done, write it to a file and go to the next episode
            torrent.on('done', () => {
                file.getBuffer((err, buffer) => {
                    // If there's an error, skip this file
                    if (err) {
                        console.error(`\nFailed to get buffer: ${err}`);
                        ii++;
                        return nextItem().catch(console.error);
                    }

                    // Write the file to a Kodi compatible title
                    fs.writeFileSync(`./${title} S01E${ep}.mkv`, buffer) // TODO: add season thing

                    // Log to the console that we're done downloading this episode
                    console.log(`\nFinished downloading EP${ep}`);

                    // Go to the next episode
                    ii++;
                    nextItem().catch(console.error);
                });
            });
        });
    }

    // Start going through the episodes and log errors if there are any
    nextItem().catch(console.error);
}

// Start going through the shows
next();

// On CTRL+C, show cursor again and exit process
process.on('SIGINT', () => {
    process.stdout.write('\x1B[?25h');
    process.exit();
});


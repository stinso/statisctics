const axios = require('axios');
const cryptoRandomString = require('crypto-random-string');
const fs = require("fs");
const ObjectsToCsv = require('objects-to-csv')


/* CONSTANTS */
const KEY = 'W2PNPD5HA9TYABR3RYUFCCSUV3UR6BBC5R'
const ADDRESS = '0xCC4304A31d09258b0029eA7FE63d032f52e44EFe'
const STAKING_ADDRESS = '0x5a753021ce28cbc5a7c51f732ba83873d673d8cc'
const BOUNDARY_STAKERS = 4000
const BOUNDARY_SWAPSCORE = 2500
const UNIX_TIMESTAMP = 1615910400

/* Member */
var stakers = 0
var swapscoreList = []
var stakersList = []
var top25Stakers = []


const date_diff_indays = (dt1, dt2) => {
  return Math.floor((Date.UTC(dt1.getFullYear(), dt1.getMonth(), dt1.getDate()) - Date.UTC(dt2.getFullYear(), dt2.getMonth(), dt2.getDate()) ) /(1000 * 60 * 60 * 24));
}


const calcScore = async () => {
  console.log('Calculate score')
  var dassAddressesDict = new Object();
  
  const today = new Date(Date.now())
  try {
    let listDict = new Object();
    let rewardsTransactionList = new Object();
    // get newest transaction
    let url = `https://api.etherscan.io/api?module=account&action=tokentx&contractaddress=${ADDRESS}&address=${STAKING_ADDRESS}&page=1&offset=1&sort=desc&apikey=${KEY}`
    let startBlockNr = 10858311
    let response = await axios.get(url);
    let transactions = response['data']['result']
    let newestBlockNr = transactions[0]['blockNumber']

    while (startBlockNr < newestBlockNr) {
      url = `https://api.etherscan.io/api?module=account&action=tokentx&contractaddress=${ADDRESS}&address=${STAKING_ADDRESS}&startblock=${startBlockNr}&endblock=999999999&sort=asc&apikey=${KEY}`
      response = await axios.get(url);
      transactions = response['data']['result']
      console.log(startBlockNr)

      // delete duplicates
      if (Object.keys(listDict).length !== 0 && listDict.constructor === Object) {
        for (const [key, value] of Object.entries(listDict)) { 
          if (value['blockNumber'] == startBlockNr) {
            delete listDict[key]
          }
        }
      }

      let lastTransaction = {
        hash: ''
      }

      transactions.forEach(function(transaction) {       
        let { blockNumber, timeStamp, hash, from, to, value } = transaction
        if (timeStamp <= UNIX_TIMESTAMP) {
          if (transaction['hash'] == lastTransaction['hash']) {
            if (transaction['to'] == STAKING_ADDRESS) {
              // staked rewards
              from = lastTransaction['from']
              rewardsTransactionList[hash] = { address: from, value };
              hash = cryptoRandomString({length: 16, type: 'base64'});
              
            }
          }
          const data = { blockNumber, timeStamp, hash, from, to, value };
          listDict[hash] = data
        }
        startBlockNr = blockNumber
        lastTransaction = transaction
      });
    }   


    Object.values(listDict).forEach((transaction) => {
      if (transaction.from !== transaction.to) {
        // stake
        if (!(transaction.to in dassAddressesDict)) {
          dassAddressesDict[transaction.to] = []  
        }

        const newUnstakeTransaction = {
          value: transaction.value,
          timeStamp: transaction.timeStamp,
          buy: false
        }
        dassAddressesDict[transaction.to].push(newUnstakeTransaction)

        // unstake
        if (!(transaction.from in dassAddressesDict)) {
          dassAddressesDict[transaction.from] = []  
        }

        const newStakeTransaction = {
          value: transaction.value,
          timeStamp: transaction.timeStamp,
          buy: true
        }
        dassAddressesDict[transaction.from].push(newStakeTransaction)
      }
    });


    // ######################### SWAPSCORE CALCULATION ######################### //
    let dass = {}
    let stakersCount = 0
    stakersList = []
    for (const [key, value] of Object.entries(dassAddressesDict)) {
      let oldTimestamp = new Date(0)
      let dailyAmount = 0
      let dailySum = 0
      let sum = 0
      let deltaDays = 0
      let threshold = 60
      let thresholdDelta = 0
      let stake = 0

      value.forEach(function(transaction) {
        let timeStamp = new Date(transaction.timeStamp * 1000)
        
        delta = date_diff_indays(timeStamp, oldTimestamp)
        thresholdDelta = date_diff_indays(today, timeStamp)
        if (thresholdDelta <= 60) {
          if (Number(delta) > 0) {
            deltaDays = threshold - thresholdDelta
            threshold = threshold - deltaDays
            dailySum = dailySum + dailyAmount
            sum = sum + deltaDays * dailySum
            dailyAmount = 0
          }
        }

        if (transaction['buy']) {
          dailyAmount = dailyAmount + Number(transaction['value'])
          stake = stake + Number(transaction['value'])
        } else {
          dailyAmount = -dailySum
          stake = 0
        }

        oldTimestamp = timeStamp
      
      });

      thresholdDelta = date_diff_indays(today, oldTimestamp)
      deltaDays = 0
      if (thresholdDelta >= 60) {
        deltaDays = 60
      } else {
        deltaDays = thresholdDelta
      }

      dailySum = dailySum + dailyAmount
      sum = sum + deltaDays * dailySum
      let avg = sum / 60 / 1000000000000000000
      if (avg > 0) {
        dass[key] = avg
        stakersCount++
      }

      // save staked amount
      const entry = [key, stake / 1000000000000000000]
      if (entry[1] > 0) {
        stakersList.push(entry)
      }
      
    }

    stakers = stakersCount
    stakersList = stakersList.sort((a,b) => b[1] - a[1])
    top25Stakers = []

    stakersList.forEach((value, index) => {
      var dassAccount = {
        id: index + 1,
        address: value[0],
        value: Math.round(parseInt(value[1]))
      }
      if (dassAccount.value >= BOUNDARY_STAKERS)
      top25Stakers.push(dassAccount)
    });

    // convert JSON object to string
    const stringifyStakers = JSON.stringify(top25Stakers);

    // write JSON string to a file
    fs.writeFile('stakers.json', stringifyStakers, (err) => {
        if (err) {
            throw err;
        }
        console.log("Stakers saved.");
    }); 

    // ################ save to database ################ //
    // clear sorted list
    swapscoreList = []
    const sortedDass = Object.entries(dass).sort((a,b) => b[1] - a[1])
    sortedDass.forEach((value, index) => {
      const account = {
        address: value[0],
        swapscore: value[1],
        swapscoreRank: index + 1
      };

      // save sorted list
      var swapscoreAccount = {
        id: account.swapscoreRank,
        address: account.address,
        value: Math.round(parseInt(account.swapscore))
      }

      if (swapscoreAccount.value >= BOUNDARY_SWAPSCORE) {
        swapscoreList.push(swapscoreAccount)
      }

    });

    // convert JSON object to string
    const stringifySwapscores = JSON.stringify(swapscoreList);
    

    // write JSON string to a file
    fs.writeFile('scores.json', stringifySwapscores, (err) => {
        if (err) {
            throw err;
        }
        console.log("Swapscores saved.");
    }); 

  } catch (error) {
    console.error(error);
  }
};

const getStakers = () => {
  return stakers
}

const getSwapscoreList = () => {
  return swapscoreList
}

const getStakersList = () => {
  return top25Stakers
}

//calcScore()

let jsonstring = []
fs.readFile('./stakers.json', 'utf8', async (err, jsonString) => {
  if (err) {
    console.log('Error')
    return
  }
  jsonstring = JSON.parse(jsonString)
  
  const newcsv = new ObjectsToCsv(jsonstring)
  await newcsv.toDisk('./stakersAbove40000_20210316.csv')
})


fs.readFile('./scores.json', 'utf8', async (err, jsonString) => {
  if (err) {
    console.log('Error')
    return
  }
  jsonstring = JSON.parse(jsonString)
  
  const newcsv = new ObjectsToCsv(jsonstring)
  await newcsv.toDisk('./scoresAbove2500_20210316.csv')
})
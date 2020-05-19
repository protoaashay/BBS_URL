const URL = require('../../dbModel/urlModel');
const User = require('../../dbModel/userModel');
const AppError = require('../../../utils/appError');
const validateSuborgUrlUpdate = require('./urlUtils').validateSuborgUrlUpdate;
const config = require('../../../utils/config');
const { isReserved, alreadyExist, dnsCheck, generateEndpoint } = require('./urlUtils');
const { incrementUserURL, decrementUserURL } = require('../userLogic');
const { incrementSuborgURL, decrementSuborgURL } = require('../suborgLogic');


// Get all the URLs
const getAllURLs = async (next) => {
    try {
        let urlList = await URL.find().lean();
        if(!urlList)
            return next(new AppError("Something went wrong.", 500));
        return urlList;
    }
    catch(err){
        next(err);
    }
};

// Get all URLs generated by a given user
const getURLsByUser = async (user, suborg, next) => {
    try {
        let urlList = await URL.find({userID: user._id, suborg:suborg}).lean();
        if(!urlList)
            return next(new AppError("No user found with the given ID", 404));
        return urlList;
    }
    catch(err){
        next(err);
    }
};

// Blacklist a URL
const blacklistURL = async (id, next) => {
    try{
        let updatedInfo = await URL.findByIdAndUpdate(id, {
           blacklisted: true
        }, {new : true});
        if(!updatedInfo)
            return next(new AppError("Failed to update. Please try again", 500));
        return updatedInfo;
    }
    catch (err) {
        next(err);
    }
}

// Whitelist a URL
const whitelistURL = async (id, next) => {
    try{
        let updatedInfo = await URL.findByIdAndUpdate(id, {
            blacklisted: false
        }, {new : true});
        if(!updatedInfo)
            return next(new AppError("Failed to update. Please try again", 500));
        return updatedInfo;
    }
    catch (err) {
        next(err);
    }
}

//Delete url
const deleteURL = async (id, userID, suborg, next) => {
    try{
        let deletedURL = await URL.deleteOne({ _id: id, userID: userID, suborg: suborg});
        if(!deletedURL)
            return next(new AppError("Failed to delete. Please try again", 500));
        console.log(`deleted url with id : ${id}`);
        await decrementUserURL(userID, next);
        if(suborg !== 'none')
            await decrementSuborgURL(suborg, next);
        return true;
    }
    catch(err){
        return next(err);
    }
}

// Get redirect URL
const getRedirectURL = async (endpoint, next) => {
    try {
        let urlData = await URL.findOne({shortURLEndPoint: endpoint, blacklisted : false}).lean();
        if(!urlData)
            // return next(new AppError("The short URL does not redirect to a valid location.", 404));
            return undefined;
        return urlData.originalURL;
    }
    catch(err){
        next(err);
    }
}

//Increment hits on URL
const incrementURLHits = async (shortURL, next) => {
    try{
        let updatedURLInfo = await URL.findOneAndUpdate(
            { shortURLEndPoint: shortURL},
            { $inc: { hits: 1 }, lastHitAt: Date.now() },
            {new: true, useFindAndModify: false});
        if(!updatedURLInfo)
            return next(new AppError("Failed to update. Please try again", 500));
        return updatedURLInfo;
    }
    catch(err){
        next(err);
    }
};

//Update custom URL (sub-organization)
const updateSuborgURL = async (url, newEndpoint, next) => {
    try{
        let isValid = validateSuborgUrlUpdate(url.suborg, newEndpoint);
        if(isValid){
            let updatedURLInfo = await URL.findOneAndUpdate(
                { _id: url._id},
                { shortURLEndPoint: newEndpoint },
                {new: true});
            if(!updatedURLInfo)
                return next(new AppError("Failed to update. Please try again", 500));
            return updatedURLInfo;
        }
    }
    catch(err){
        next(err);
    }
}

//Create a new short URL
const createNewShortURL = async (urlInfo, next) => {
    try{
        let urlCreator;
        urlCreator = await User.findById(urlInfo.userID);
        if(urlCreator.blacklisted){
            return new AppError("You are forbidden to perform this action by admin.", 403)
        }


        if(!urlInfo.originalURL.startsWith('https://') && !urlInfo.originalURL.startsWith('http://') && !urlInfo.originalURL.startsWith('ftp://'))
            urlInfo.originalURL = 'https://'+urlInfo.originalURL;

        let isValid = await dnsCheck(urlInfo.originalURL, next);
        if(!isValid){
            return next(new AppError("Original URL doesn't exist", 400));
        }

        let shortURLEndPoint;
        if(urlInfo.wantCustomURL){
            shortURLEndPoint = urlInfo.customURL
            if(isReserved(shortURLEndPoint)){
                return next(new AppError("The requested custom URL is reserved", 400));
            }
            let existsAlready = await alreadyExist(shortURLEndPoint);
            if(existsAlready){
                return next(new AppError("The requested custom URL already exists", 400));
            }
        }else{
            shortURLEndPoint = await generateEndpoint();
        }

        let newURL = new URL(
            {
                email: urlInfo.email,
                name: urlInfo.name,
                userID: urlInfo.userID,
                shortURLEndPoint: shortURLEndPoint,
                originalURL: urlInfo.originalURL
            });
        let newURLData = await newURL.save();
        if(!newURLData)
            return next(new AppError("Failed to create. Please try again", 500));
        await incrementUserURL(urlInfo.userID, next);
        return newURLData;
    }
    catch(err){
        console.log(err);
        next(err);
    }
};

//Create a new short URL for suborg
const createNewSuborgURL = async (urlInfo, next) => {
    try{
        //throw error
        let urlCreator = await User.findById(urlInfo.userID);
        if(urlCreator.blacklisted){
            return new AppError("You are forbidden to perform this action by admin.", 403)
        }
        let isValid = await dnsCheck(urlInfo.originalURL);
        if(!isValid){
            return next(new AppError("Original URL doesn't exist", 400));
        }
        if(!urlInfo.originalURL.startsWith('https://') && !urlInfo.originalURL.startsWith('http://') && !urlInfo.originalURL.startsWith('ftp://'))
            urlInfo.originalURL = 'https://' + urlInfo.originalURL;

        let shortURLEndPoint;
        if(urlInfo.wantCustom){
            shortURLEndPoint = urlInfo.suborg + '/' + urlInfo.customURL;
        }
        else{
            shortURLEndPoint = await generateEndpoint();
            shortURLEndPoint = urlInfo.suborg + '/' + shortURLEndPoint;
        }

        let urlCount = await URL.count({ shortURLEndPoint: shortURLEndPoint});
        if(urlCount > 0)
            return next(new AppError("This custom URL already exists.", 400));

        // console.log(urlInfo);
        let newURL = new URL(
            {
                email: urlInfo.email,
                name: urlInfo.name,
                userID: urlInfo.userID,
                suborg: urlInfo.suborg,
                shortURLEndPoint: shortURLEndPoint,
                originalURL: urlInfo.originalURL,
            });
        let newURLData = await newURL.save();
        if(!newURLData)
            return next(new AppError("Failed to create. Please try again", 500));
        await incrementUserURL(urlInfo.userID, next);
        await incrementSuborgURL(urlInfo.suborg, next);
        return newURLData;
    }
    catch(err){
        console.log(err);
        return next(err);
    }
};

module.exports = {
    getAllURLs,
    getURLsByUser,
    blacklistURL,
    whitelistURL,
    deleteURL,
    getRedirectURL,
    incrementURLHits,
    updateSuborgURL,
    createNewShortURL,
    createNewSuborgURL
};

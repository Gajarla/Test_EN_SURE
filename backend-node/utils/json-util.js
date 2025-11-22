//  to validate any json file
function isValidJSON(jsonString){
    try{
        if (typeof jsonString !== "string"){
            return false;
        }
            JSON.parse(jsonString);
            return true;                             
    }
    catch (error){
        return false;
    }
  }

  //  to extract the data from json file in a recursive way
  function extractDataFromJSON(obj) {
    let collection = {};
    for (let prop in obj) {
      if(Array.isArray(obj[prop])){
        let arr= obj[prop];
        let resultArray = []
        arr.forEach(item => {
          if(typeof item === "string"){
            resultArray.push(item);
          }
          else{
            resultArray.push(extractDataFromJSON(item));
          }
        });
        collection[prop] = resultArray;
      }
      else if(obj[prop] !== null && typeof obj[prop] === "object")
      {
        return extractDataFromJSON(obj[prop]);
      }
      else{
        collection[prop] = obj[prop];
      }
     
  }
    return collection;
  }
  module.exports = {isValidJSON, extractDataFromJSON};
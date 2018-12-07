'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
const faker = require('faker');
const mongoose = require('mongoose');

// this makes the expect syntax available throughout
// this module
const should = chai.should();

const {BlogPost} = require('../models');
const {app, runServer, closeServer} = require('../server');
const {TEST_DATABASE_URL} = require('../config');

chai.use(chaiHttp);

// used to put randomish documents in db
// so we have data to work with and assert about.
// generate placeholder values for author, title, content
// and then we insert that data into mongo
function seedBlogPostData() {
  console.info('seeding blog post data');
  const seedData = [];

  for (let i=1; i<=10; i++) {
    seedData.push({
        author: {
          firstName: faker.name.firstName(),
          lastName: faker.name.lastName()
        },
        title: faker.lorem.sentence(),
        content: faker.lorem.text()
      });
  }
  // this will return a promise
  return BlogPost.insertMany(seedData);
}

// this function deletes the entire database.
// we'll call it in an `afterEach` block below
// to ensure data from one test does not stick
// around for next one
function tearDownDb() {
    return new Promise((resolve, reject) => {
      console.warn('Deleting database');
      mongoose.connection.dropDatabase()
        .then(result => resolve(result))
        .catch(err => reject(err));
    });
  }
describe('BlogPost API resource', function() {

  // we need each of these hook functions to return a promise
  // otherwise we'd need to call a `done` callback. `runServer`,
  // `seedBlogPostData` and `tearDownDb` each return a promise,
  // so we return the value returned by these function calls.
  before(function() {
    return runServer(TEST_DATABASE_URL);
  });

  beforeEach(function() {
    return seedBlogPostData();
  });

  afterEach(function() {
    return tearDownDb();
  });

  after(function() {
    return closeServer();
  });

  // note the use of nested `describe` blocks.
  // this allows us to make clearer, more discrete tests that focus
  // on proving something small
  describe('GET endpoint', function() {

    it('should return all existing blog posts', function() {
      // strategy:
      //    1. get back all blog posts returned by by GET request to `/posts`
      //    2. prove res has right status, data type
      //    3. prove the number of blog posts we got back is equal to number
      //       in db.
      //
      // need to have access to mutate and access `res` across
      // `.then()` calls below, so declare it here so can modify in place
      let res;
      return chai.request(app)
        .get('/posts')
        .then(_res => {
          res = _res;
          res.should.have.status(200);
          // otherwise our db seeding didn't work
          res.body.should.have.lengthOf.at.least(1);

          return BlogPost.count();
        })
        .then(count => {
          // the number of returned posts should be same
          // as number of posts in DB
          res.body.should.have.lengthOf(count);
        });
    });


    it('should return blog posts with right fields', function() {
      // Strategy: Get back all blog posts, and ensure they have expected keys
      let resPost;
      return chai.request(app)
        .get('/posts')
        .then(function (res) {

          res.should.have.status(200);
          res.should.be.json;
          res.body.should.be.a('array');
          res.body.should.have.lengthOf.at.least(1);

          res.body.forEach(function (post) {
            post.should.be.a('object');
            post.should.include.keys('id', 'title', 'content', 'author', 'created');
          });
          // just check one of the posts that its values match with those in db
          // and we'll assume it's true for rest
          resPost = res.body[0];
          return BlogPost.findById(resPost.id);
        })
        .then(post => {
          resPost.title.should.equal(post.title);
          resPost.content.should.equal(post.content);
          resPost.author.should.equal(post.authorName);
        });
    });
  });

  describe('POST endpoint', function() {
    // strategy: make a POST request with data,
    // then prove that the blog post we get back has
    // right keys, and that `id` is there (which means
    // the data was inserted into db)
    it('should add a new blog post', function() {

      const newBlogPost = {
        title: faker.lorem.sentence(),
        author: {
          firstName: faker.name.firstName(),
          lastName: faker.name.lastName(),
        },
        content: faker.lorem.text()
      };

      return chai.request(app)
      .post('/posts')
      .send(newBlogPost)
      .then(function (res) {
        res.should.have.status(201);
        res.should.be.json;
        res.body.should.be.a('object');
        res.body.should.include.keys(
          'id', 'title', 'content', 'author', 'created');
        res.body.title.should.equal(newBlogPost.title);
        // cause Mongo should have created id on insertion
        res.body.id.should.not.be.null;
        res.body.author.should.equal(
          `${newBlogPost.author.firstName} ${newBlogPost.author.lastName}`);
        res.body.content.should.equal(newBlogPost.content);
        return BlogPost.findById(res.body.id);
      })
      .then(function (post) {
        post.title.should.equal(newBlogPost.title);
        post.content.should.equal(newBlogPost.content);
        post.author.firstName.should.equal(newBlogPost.author.firstName);
        post.author.lastName.should.equal(newBlogPost.author.lastName);
      });
    });
  });

  describe('PUT endpoint', function() {

    // strategy:
    //  1. Get an existing blog post from db
    //  2. Make a PUT request to update that blog post
    //  3. Prove blog post returned by request contains data we sent
    //  4. Prove blog post in db is correctly updated
    it('should update fields you send over', function() {
      const updateData  = {
        title: 'cats cats cats',
        content: 'dogs dogs dogs',
        author: {
          firstName: 'foo',
          lastName: 'bar'
        }
      };

      return BlogPost
        .findOne()
        .then(post => {
          updateData.id = post.id;

          return chai.request(app)
            .put(`/posts/${post.id}`)
            .send(updateData);
        })
        .then(res => {
          res.should.have.status(204);
          return BlogPost.findById(updateData.id);
        })
        .then(post => {
          post.title.should.equal(updateData.title);
          post.content.should.equal(updateData.content);
          post.author.firstName.should.equal(updateData.author.firstName);
          post.author.lastName.should.equal(updateData.author.lastName);
        });
    });
  });

  describe('DELETE endpoint', function() {
    // strategy:
    //  1. get a blog post
    //  2. make a DELETE request for that blog post's id
    //  3. assert that response has right status code
    //  4. prove that blog post with the id doesn't exist in db anymore
    it('delete a blog post by id', function() {

    let post;

    return BlogPost
        .findOne()
        .then(_post => {
        post = _post;
        return chai.request(app).delete(`/posts/${post.id}`);
        })
        .then(res => {
        res.should.have.status(204);
        return BlogPost.findById(post.id);
        })
        .then(_post => {
        // when a variable's value is null, chaining `should`
        // doesn't work. so `_post.should.be.null` would raise
        // an error. `should.be.null(_post)` is how we can
        // make assertions about a null value.
        should.not.exist(_post);
        });
    });
  });
});

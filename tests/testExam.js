var ERR = require('async-stacktrace');
var _ = require('lodash');
var assert = require('chai').assert;
var request = require('request');
var cheerio = require('cheerio');

var config = require('../lib/config');
var sqldb = require('../lib/sqldb');
var sqlLoader = require('../lib/sql-loader');
var sql = sqlLoader.loadSqlEquiv(__filename);

var helperServer = require('./helperServer');
var helperQuestion = require('./helperQuestion');

const locals = {};

// sorted alphabetically by qid
const questionsArray = [
    {qid: 'addNumbers', type: 'Freeform', maxPoints: 5},
    {qid: 'addVectors', type: 'Calculation', maxPoints: 11},
    {qid: 'fossilFuelsRadio', type: 'Calculation', maxPoints: 17},
    {qid: 'partialCredit1', type: 'Freeform', maxPoints: 19},
    {qid: 'partialCredit2', type: 'Freeform', maxPoints: 9},
    {qid: 'partialCredit3', type: 'Freeform', maxPoints: 13},
];

const questions = _.keyBy(questionsArray, 'qid');

const assessmentMaxPoints = 74;

// each outer entry is a whole exam session
// each inner entry is a list of question submissions
//     score: value to submit, will be the percentage score for the submission
//     action: 'save' or 'grade'
//     sub_points: additional points awarded for this submission (NOT total points for the question)
//     succeed: true or false
const partialCreditTests = [
    [
        // answer every question correctly immediately
        {qid: 'partialCredit1', action: 'grade', score: 100, succeed: true, sub_points: 19},
        {qid: 'partialCredit2', action: 'grade', score: 100, succeed: true, sub_points: 9},
        {qid: 'partialCredit3', action: 'grade', score: 100, succeed: true, sub_points: 13},
    ],
    [
        // answer questions correctly on the second try
        {qid: 'partialCredit1', action: 'grade', score: 100, succeed: true, sub_points: 19},
        {qid: 'partialCredit2', action: 'grade', score: 37,  succeed: true, sub_points: 9*0.37},
        {qid: 'partialCredit2', action: 'grade', score: 100, succeed: true, sub_points: 7*(1-0.37)},
        {qid: 'partialCredit3', action: 'grade', score: 71,  succeed: true, sub_points: 13*0.71},
        {qid: 'partialCredit3', action: 'grade', score: 100, succeed: true, sub_points: 13*(1-0.71)},
    ],
    [
        // use all the attempts for each question
        {qid: 'partialCredit1', action: 'save',  score: 100, succeed: true, sub_points: 0},
        {qid: 'partialCredit1', action: 'grade', score: 24,  succeed: true, sub_points: 19*0.24},
        {qid: 'partialCredit2', action: 'grade', score: 0,   succeed: true, sub_points: 0},
        {qid: 'partialCredit2', action: 'save',  score: 97,  succeed: true, sub_points: 0},
        {qid: 'partialCredit2', action: 'grade', score: 14,  succeed: true, sub_points: 7*0.14},
        {qid: 'partialCredit2', action: 'grade', score: 8,   succeed: true, sub_points: 0},
        {qid: 'partialCredit2', action: 'save',  score: 0,   succeed: true, sub_points: 0},
        {qid: 'partialCredit2', action: 'grade', score: 27,  succeed: true, sub_points: 3*(0.27-0.14)},
        {qid: 'partialCredit3', action: 'save',  score: 100, succeed: true, sub_points: 0},
        {qid: 'partialCredit3', action: 'grade', score: 63,  succeed: true, sub_points: 13*0.63},
        {qid: 'partialCredit3', action: 'grade', score: 63,  succeed: true, sub_points: 0},
        {qid: 'partialCredit3', action: 'grade', score: 64,  succeed: true, sub_points: 8*(0.64-0.63)},
        {qid: 'partialCredit3', action: 'save',  score: 72,  succeed: true, sub_points: 0},
        {qid: 'partialCredit3', action: 'grade', score: 7,   succeed: true, sub_points: 0},
        {qid: 'partialCredit3', action: 'grade', score: 97,  succeed: true, sub_points: 0.1*(0.97-0.64)},
    ],
    [
        // same as above, but in an interspersed order
        {qid: 'partialCredit2', action: 'save',  score: 97,  succeed: true, sub_points: 0},
        {qid: 'partialCredit3', action: 'grade', score: 63,  succeed: true, sub_points: 13*0.63},
        {qid: 'partialCredit3', action: 'save',  score: 100, succeed: true, sub_points: 0},
        {qid: 'partialCredit2', action: 'grade', score: 0,   succeed: true, sub_points: 0},
        {qid: 'partialCredit1', action: 'save',  score: 100, succeed: true, sub_points: 0},
        {qid: 'partialCredit3', action: 'grade', score: 63,  succeed: true, sub_points: 0},
        {qid: 'partialCredit2', action: 'grade', score: 14,  succeed: true, sub_points: 7*0.14},
        {qid: 'partialCredit2', action: 'save',  score: 0,   succeed: true, sub_points: 0},
        {qid: 'partialCredit3', action: 'save',  score: 72,  succeed: true, sub_points: 0},
        {qid: 'partialCredit1', action: 'grade', score: 24,  succeed: true, sub_points: 19*0.24},
        {qid: 'partialCredit3', action: 'grade', score: 64,  succeed: true, sub_points: 8*(0.64-0.63)},
        {qid: 'partialCredit3', action: 'grade', score: 7,   succeed: true, sub_points: 0},
        {qid: 'partialCredit2', action: 'grade', score: 8,   succeed: true, sub_points: 0},
        {qid: 'partialCredit3', action: 'grade', score: 97,  succeed: true, sub_points: 0.1*(0.97-0.64)},
        {qid: 'partialCredit2', action: 'grade', score: 27,  succeed: true, sub_points: 3*(0.27-0.14)},
    ],
];

describe('Exam assessment', function() {
    this.timeout(5000);

    before('set up testing server', helperServer.before);
    after('shut down testing server', helperServer.after);

    var res, page, elemList;

    var startExam = function() {
        describe('the locals object', function() {
            it('should be cleared', function() {
                for (var prop in locals) {
                    delete locals[prop];
                }
            });
            it('should be initialized', function() {
                locals.siteUrl = 'http://localhost:' + config.serverPort;
                locals.baseUrl = locals.siteUrl + '/pl';
                locals.courseInstanceBaseUrl = locals.baseUrl + '/course_instance/1';
                locals.questionBaseUrl = locals.courseInstanceBaseUrl + '/instance_question';
                locals.assessmentsUrl = locals.courseInstanceBaseUrl + '/assessments';
                locals.isStudentPage = true;
                locals.totalPoints = 0;
            });
        });

        describe('the questions', function() {
            it('should have cleared data', function() {
                questionsArray.forEach(function(question) {
                    for (var prop in question) {
                        if (prop != 'qid' && prop != 'type' && prop != 'maxPoints') {
                            delete question[prop];
                        }
                    }
                    question.points = 0;
                });
            });
        });

        describe('1. the database', function() {
            it('should contain E1', function(callback) {
                sqldb.queryOneRow(sql.select_e1, [], function(err, result) {
                    if (ERR(err, callback)) return;
                    locals.assessment_id = result.rows[0].id;
                    callback(null);
                });
            });
        });

        describe('2. GET to assessments URL', function() {
            it('should load successfully', function(callback) {
                request(locals.assessmentsUrl, function (error, response, body) {
                    if (error) {
                        return callback(error);
                    }
                    if (response.statusCode != 200) {
                        return callback(new Error('bad status: ' + response.statusCode));
                    }
                    res = response;
                    page = body;
                    callback(null);
                });
            });
            it('should parse', function() {
                locals.$ = cheerio.load(page);
            });
            it('should contain E1', function() {
                elemList = locals.$('td a:contains("Exam for automatic test suite")');
                assert.lengthOf(elemList, 1);
            });
            it('should have the correct link for E1', function() {
                locals.assessmentUrl = locals.siteUrl + elemList[0].attribs.href;
                assert.equal(locals.assessmentUrl, locals.courseInstanceBaseUrl + '/assessment/' + locals.assessment_id + '/');
            });
        });

        describe('3. GET to assessment URL', function() {
            it('should load successfully', function(callback) {
                request(locals.assessmentUrl, function (error, response, body) {
                    if (error) {
                        return callback(error);
                    }
                    if (response.statusCode != 200) {
                        return callback(new Error('bad status: ' + response.statusCode));
                    }
                    res = response;
                    page = body;
                    callback(null);
                });
            });
            it('should parse', function() {
                locals.$ = cheerio.load(page);
            });
            it('should contain "Please wait"', function() {
                elemList = locals.$('p.lead:contains("Please wait")');
                assert.lengthOf(elemList, 1);
            });
            it('should contain "Exam 1"', function() {
                elemList = locals.$('p.lead strong:contains("Exam 1")');
                assert.lengthOf(elemList, 1);
            });
            it('should contain "TPL 101"', function() {
                elemList = locals.$('p.lead strong:contains("TPL 101")');
                assert.lengthOf(elemList, 1);
            });
            it('should have a CSRF token', function() {
                elemList = locals.$('form input[name="__csrf_token"]');
                assert.lengthOf(elemList, 1);
                assert.deepProperty(elemList[0], 'attribs.value');
                locals.__csrf_token = elemList[0].attribs.value;
                assert.isString(locals.__csrf_token);
            });
        });

        describe('4. POST to assessment URL', function() {
            it('should load successfully', function(callback) {
                var form = {
                    __action: 'newInstance',
                    __csrf_token: locals.__csrf_token,
                };
                locals.preStartTime = Date.now();
                request.post({url: locals.assessmentUrl, form: form, followAllRedirects: true}, function (error, response, body) {
                    if (error) {
                        return callback(error);
                    }
                    locals.postStartTime = Date.now();
                    if (response.statusCode != 200) {
                        return callback(new Error('bad status: ' + response.statusCode));
                    }
                    res = response;
                    page = body;
                    callback(null);
                });
            });
            it('should parse', function() {
                locals.$ = cheerio.load(page);
            });
            it('should redirect to the correct path', function() {
                locals.assessmentInstanceUrl = locals.siteUrl + res.req.path;
                assert.equal(res.req.path, '/pl/course_instance/1/assessment_instance/1');
            });
            it('should create one assessment_instance', function(callback) {
                sqldb.query(sql.select_assessment_instances, [], function(err, result) {
                    if (ERR(err, callback)) return;
                    if (result.rowCount != 1) {
                        return callback(new Error('expected one assessment_instance, got: ' + result.rowCount));
                    }
                    locals.assessment_instance = result.rows[0];
                    callback(null);
                });
            });
            it('should have the correct assessment_instance.assessment_id', function() {
                assert.equal(locals.assessment_instance.assessment_id, locals.assessment_id);
            });
            it(`should create ${questionsArray.length} instance_questions`, function(callback) {
                sqldb.query(sql.select_instance_questions, [], function(err, result) {
                    if (ERR(err, callback)) return;
                    if (result.rowCount != questionsArray.length) {
                        return callback(new Error(`expected ${questionsArray.length} instance_questions, got: ` + result.rowCount));
                    }
                    locals.instance_questions = result.rows;
                    callback(null);
                });
            });
            questionsArray.forEach(function(question, i) {
                it(`should have question #${i+1} as QID ${question.qid}`, function() {
                    question.id = locals.instance_questions[i].id;
                    assert.equal(locals.instance_questions[i].qid, question.qid);
                });
            });
        });

        describe('5. GET to assessment_instance URL', function() {
            it('should load successfully', function(callback) {
                request(locals.assessmentInstanceUrl, function (error, response, body) {
                    if (error) {
                        return callback(error);
                    }
                    if (response.statusCode != 200) {
                        return callback(new Error('bad status: ' + response.statusCode));
                    }
                    res = response;
                    page = body;
                    callback(null);
                });
            });
            it('should parse', function() {
                locals.$ = cheerio.load(page);
            });
            questionsArray.forEach(function(question, i) {
                it(`should link to ${question.qid} question`, function() {
                    const urlTail = '/pl/course_instance/1/instance_question/' + question.id + '/';
                    question.url = locals.siteUrl + urlTail;
                    elemList = locals.$(`td a[href="${urlTail}"]`);
                    assert.lengthOf(elemList, 1);
                });
            });
        });
    };

    startExam();

    describe('6. save correct answer to question addVectors', function() {
        describe('setting up the submission data', function() {
            it('should succeed', function() {
                locals.shouldHaveButtons = ['grade', 'save'];
                locals.postAction = 'save';
                locals.question = questions.addVectors;
                locals.expectedResult = {
                    submission_score: null,
                    submission_correct: null,
                    instance_question_points: 0,
                    instance_question_score_perc: 0/11 * 100,
                    assessment_instance_points: 0,
                    assessment_instance_score_perc: 0/assessmentMaxPoints * 100,
                };
                locals.getSubmittedAnswer = function(variant) {
                    return {
                        wx: variant.true_answer.wx,
                        wy: variant.true_answer.wy,
                    };
                };
            });
        });
        helperQuestion.getInstanceQuestion(locals);
        helperQuestion.postInstanceQuestion(locals);
        helperQuestion.checkQuestionScore(locals);
        helperQuestion.checkAssessmentScore(locals);
    });

    describe('7. grade incorrect answer to question addVectors', function() {
        describe('setting up the submission data', function() {
            it('should succeed', function() {
                locals.shouldHaveButtons = ['grade', 'save'];
                locals.postAction = 'grade';
                locals.question = questions.addVectors;
                locals.expectedResult = {
                    submission_score: 0,
                    submission_correct: false,
                    instance_question_points: 0,
                    instance_question_score_perc: 0/11 * 100,
                    assessment_instance_points: 0,
                    assessment_instance_score_perc: 0/assessmentMaxPoints * 100,
                };
                locals.getSubmittedAnswer = function(_variant) {
                    return {
                        wx: -500,
                        wy: 700,
                    };
                };
            });
        });
        helperQuestion.getInstanceQuestion(locals);
        helperQuestion.postInstanceQuestion(locals);
        helperQuestion.checkQuestionScore(locals);
        helperQuestion.checkAssessmentScore(locals);
    });

    describe('8. grade incorrect answer to question addNumbers', function() {
        describe('setting up the submission data', function() {
            it('should succeed', function() {
                locals.shouldHaveButtons = ['grade', 'save'];
                locals.postAction = 'grade';
                locals.question = questions.addNumbers;
                locals.expectedResult = {
                    submission_score: 0,
                    submission_correct: false,
                    instance_question_points: 0,
                    instance_question_score_perc: 0/5 * 100,
                    assessment_instance_points: 0,
                    assessment_instance_score_perc: 0/assessmentMaxPoints * 100,
                };
                locals.getSubmittedAnswer = function(variant) {
                    return {
                        c: variant.true_answer.c + 1,
                    };
                };
            });
        });
        helperQuestion.getInstanceQuestion(locals);
        helperQuestion.postInstanceQuestion(locals);
        helperQuestion.checkQuestionScore(locals);
        helperQuestion.checkAssessmentScore(locals);
    });

    describe('9. grade incorrect answer to question fossilFuelsRadio', function() {
        describe('setting up the submission data', function() {
            it('should succeed', function() {
                locals.shouldHaveButtons = ['grade', 'save'];
                locals.postAction = 'grade';
                locals.question = questions.fossilFuelsRadio;
                locals.expectedResult = {
                    submission_score: 0,
                    submission_correct: false,
                    instance_question_points: 0,
                    instance_question_score_perc: 0/17 * 100,
                    assessment_instance_points: 0,
                    assessment_instance_score_perc: 0/assessmentMaxPoints * 100,
                };
                locals.getSubmittedAnswer = function(variant) {
                    return {
                        key: (variant.true_answer.key == 'a') ? 'b' : 'a',
                    };
                };
            });
        });
        helperQuestion.getInstanceQuestion(locals);
        helperQuestion.postInstanceQuestion(locals);
        helperQuestion.checkQuestionScore(locals);
        helperQuestion.checkAssessmentScore(locals);
    });

    describe('10. grade invalid answer to question addNumbers', function() {
        describe('setting up the submission data', function() {
            it('should succeed', function() {
                locals.shouldHaveButtons = ['grade', 'save'];
                locals.postAction = 'grade';
                locals.question = questions.addNumbers;
                locals.expectedResult = {
                    submission_score: null,
                    submission_correct: null,
                    instance_question_points: 0,
                    instance_question_score_perc: 0/17 * 100,
                    assessment_instance_points: 0,
                    assessment_instance_score_perc: 0/assessmentMaxPoints * 100,
                };
                locals.getSubmittedAnswer = function(_variant) {
                    return {
                        c: 'not_a_number',
                    };
                };
            });
        });
        helperQuestion.getInstanceQuestion(locals);
        helperQuestion.postInstanceQuestion(locals);
        helperQuestion.checkQuestionScore(locals);
        helperQuestion.checkAssessmentScore(locals);
        describe('check the submission is not gradable', function() {
            it('should succeed', function(callback) {
                sqldb.queryOneRow(sql.select_last_submission, [], function(err, result) {
                    if (ERR(err, callback)) return;
                    const submission = result.rows[0];
                    if (submission.gradable) return callback(new Error('submission.gradable is true'));
                    callback(null);
                });
            });
        });
        describe('the submission panel contents', function() {
            it('should contain "INVALID"', function() {
                elemList = locals.$('div.submission-body :contains("INVALID")');
                assert.isAtLeast(elemList.length, 1);
            });
        });
    });

    describe('11. save incorrect answer to question addNumbers', function() {
        describe('setting up the submission data', function() {
            it('should succeed', function() {
                locals.shouldHaveButtons = ['grade', 'save'];
                locals.postAction = 'save';
                locals.question = questions.addNumbers;
                locals.getSubmittedAnswer = function(variant) {
                    return {
                        c: variant.true_answer.c - 1,
                    };
                };
            });
        });
        helperQuestion.getInstanceQuestion(locals);
        helperQuestion.postInstanceQuestion(locals);
        helperQuestion.checkQuestionScore(locals);
        helperQuestion.checkAssessmentScore(locals);
    });

    describe('12. break the addNumbers variant', function() {
        describe('setting the question', function() {
            it('should succeed', function() {
                locals.shouldHaveButtons = ['grade', 'save'];
                locals.postAction = 'save';
                locals.question = questions.addNumbers;
            });
        });
        helperQuestion.getInstanceQuestion(locals);
        describe('breaking the variant', function() {
            it('should succeed', function(callback) {
                let params = {
                    variant_id: locals.variant.id,
                    broken: true,
                };
                sqldb.queryOneRow(sql.variant_update_broken, params, function(err, _result) {
                    if (ERR(err, callback)) return;
                    callback(null);
                });
            });
        });
    });

    describe('13. a broken variant', function() {
        describe('setting the question', function() {
            it('should succeed', function() {
                locals.shouldHaveButtons = [];
                locals.postAction = 'save';
                locals.question = questions.addNumbers;
            });
        });
        helperQuestion.getInstanceQuestion(locals);
        describe('the question panel contents', function() {
            it('should contain "Broken question"', function() {
                elemList = locals.$('div.question-body:contains("Broken question")');
                assert.lengthOf(elemList, 1);
            });
        });
        describe('un-breaking the variant', function() {
            it('should succeed', function(callback) {
                let params = {
                    variant_id: locals.variant.id,
                    broken: false,
                };
                sqldb.queryOneRow(sql.variant_update_broken, params, function(err, _result) {
                    if (ERR(err, callback)) return;
                    callback(null);
                });
            });
        });
    });

    describe('14. load question addNumbers page and save data for later submission', function() {
        describe('setting up the submission data', function() {
            it('should succeed', function() {
                locals.shouldHaveButtons = ['grade', 'save'];
                locals.question = questions.addNumbers;
            });
        });
        helperQuestion.getInstanceQuestion(locals);
        describe('save data for later submission', function() {
            it('should succeed', function() {
                locals.savedVariant = _.clone(locals.variant);
                locals.questionSavedCsrfToken = locals.__csrf_token;
            });
        });
    });

    describe('15. grade correct answer to question addNumbers', function() {
        describe('setting up the submission data', function() {
            it('should succeed', function() {
                locals.shouldHaveButtons = ['grade', 'save'];
                locals.postAction = 'grade';
                locals.question = questions.addNumbers;
                locals.expectedResult = {
                    submission_score: 1,
                    submission_correct: true,
                    instance_question_points: 3,
                    instance_question_score_perc: 3/5 * 100,
                    assessment_instance_points: 3,
                    assessment_instance_score_perc: 3/assessmentMaxPoints * 100,
                };
                locals.getSubmittedAnswer = function(variant) {
                    return {
                        c: variant.true_answer.c,
                    };
                };
            });
        });
        helperQuestion.getInstanceQuestion(locals);
        helperQuestion.postInstanceQuestion(locals);
        helperQuestion.checkQuestionScore(locals);
        helperQuestion.checkAssessmentScore(locals);
    });

    describe('16. save correct answer to saved question addNumbers page', function() {
        describe('setting up the submission data', function() {
            it('should succeed', function() {
                locals.question = questions.addNumbers;
                locals.postAction = 'save';
                locals.getSubmittedAnswer = function(variant) {
                    return {
                        c: variant.true_answer.c,
                    };
                };
            });
        });
        describe('restore saved data for submission', function() {
            it('should succeed', function() {
                locals.variant = _.clone(locals.savedVariant);
                locals.__csrf_token = locals.questionSavedCsrfToken;
            });
        });
        helperQuestion.postInstanceQuestionAndFail(locals);
    });

    describe('17. save incorrect answer to question fossilFuelsRadio', function() {
        describe('setting up the submission data', function() {
            it('should succeed', function() {
                locals.shouldHaveButtons = ['grade', 'save'];
                locals.postAction = 'save';
                locals.question = questions.fossilFuelsRadio;
                locals.expectedResult = {
                    submission_score: null,
                    submission_correct: null,
                    instance_question_points: 0,
                    instance_question_score_perc: 0/17 * 100,
                    assessment_instance_points: 3,
                    assessment_instance_score_perc: 3/assessmentMaxPoints * 100,
                };
                locals.getSubmittedAnswer = function(variant) {
                    return {
                        key: (variant.true_answer.key == 'a') ? 'b' : 'a',
                    };
                };
            });
        });
        helperQuestion.getInstanceQuestion(locals);
        helperQuestion.postInstanceQuestion(locals);
        helperQuestion.checkQuestionScore(locals);
        helperQuestion.checkAssessmentScore(locals);
    });

    describe('18. load question addVectors page and save data for later submission', function() {
        describe('setting up the submission data', function() {
            it('should succeed', function() {
                locals.shouldHaveButtons = ['grade', 'save'];
                locals.question = questions.addVectors;
            });
        });
        helperQuestion.getInstanceQuestion(locals);
        describe('save data for later submission', function() {
            it('should succeed', function() {
                locals.savedVariant = _.clone(locals.variant);
                locals.questionSavedCsrfToken = locals.__csrf_token;
            });
        });
    });

    describe('19. grade incorrect answer to question addVectors', function() {
        describe('setting up the submission data', function() {
            it('should succeed', function() {
                locals.shouldHaveButtons = ['grade', 'save'];
                locals.postAction = 'grade';
                locals.question = questions.addVectors;
                locals.expectedResult = {
                    submission_score: 0,
                    submission_correct: false,
                    instance_question_points: 0,
                    instance_question_score_perc: 0/11 * 100,
                    assessment_instance_points: 3,
                    assessment_instance_score_perc: 3/assessmentMaxPoints * 100,
                };
                locals.getSubmittedAnswer = function(_variant) {
                    return {
                        wx: 2000,
                        wy: -3000,
                    };
                };
            });
        });
        helperQuestion.getInstanceQuestion(locals);
        helperQuestion.postInstanceQuestion(locals);
        helperQuestion.checkQuestionScore(locals);
        helperQuestion.checkAssessmentScore(locals);
    });

    describe('20. submit correct answer to saved question addVectors page', function() {
        describe('setting up the submission data', function() {
            it('should succeed', function() {
                locals.question = questions.addVectors;
                locals.postAction = 'save';
                locals.getSubmittedAnswer = function(variant) {
                    return {
                        wx: variant.true_answer.wx,
                        wy: variant.true_answer.wy,
                    };
                };
            });
        });
        describe('restore saved data for submission', function() {
            it('should succeed', function() {
                locals.variant = _.clone(locals.savedVariant);
                locals.__csrf_token = locals.questionSavedCsrfToken;
            });
        });
        helperQuestion.postInstanceQuestionAndFail(locals);
    });

    describe('21. load question fossilFuelsRadio page and save data for later submission', function() {
        describe('setting up the submission data', function() {
            it('should succeed', function() {
                locals.shouldHaveButtons = ['grade', 'save'];
                locals.question = questions.fossilFuelsRadio;
            });
        });
        helperQuestion.getInstanceQuestion(locals);
        describe('save data for later submission', function() {
            it('should succeed', function() {
                locals.savedVariant = _.clone(locals.variant);
                locals.questionSavedCsrfToken = locals.__csrf_token;
            });
        });
    });

    describe('22. close exam', function() {
        it('should succeed', function(callback) {
            sqldb.queryOneRow(sql.close_all_assessment_instances, [], function(err, _result) {
                if (ERR(err, callback)) return;
                callback(null);
            });
        });
    });

    describe('23. save correct answer to saved question fossilFuelsRadio page', function() {
        describe('setting up the submission data', function() {
            it('should succeed', function() {
                locals.question = questions.fossilFuelsRadio;
                locals.postAction = 'save';
                locals.getSubmittedAnswer = function(variant) {
                    return {
                        key: variant.true_answer.key,
                    };
                };
            });
        });
        describe('restore saved data for submission', function() {
            it('should succeed', function() {
                locals.variant = _.clone(locals.savedVariant);
                locals.__csrf_token = locals.questionSavedCsrfToken;
            });
        });
        helperQuestion.postInstanceQuestionAndFail(locals);
    });

    describe('24. regrading', function() {
        describe('set forceMaxPoints = true for question addVectors', function() {
            it('should succeed', function(callback) {
                sqldb.query(sql.update_addVectors_force_max_points, [], function(err, _result) {
                    if (ERR(err, callback)) return;
                    callback(null);
                });
            });
        });
        helperQuestion.regradeAssessment(locals);
        describe('check the regrading succeeded', function() {
            describe('setting up the expected question addNumbers results', function() {
                it('should succeed', function() {
                    locals.question = questions.addNumbers;
                    locals.expectedResult = {
                        submission_score: 1,
                        submission_correct: true,
                        instance_question_points: 3,
                        instance_question_score_perc: 3/5 * 100,
                    };
                });
            });
            helperQuestion.checkQuestionScore(locals);
            describe('setting up the expected question addVectors results', function() {
                it('should succeed', function() {
                    locals.question = questions.addVectors;
                    locals.expectedResult = {
                        submission_score: 0,
                        submission_correct: false,
                        instance_question_points: 11,
                        instance_question_score_perc: 11/11 * 100,
                    };
                });
            });
            helperQuestion.checkQuestionScore(locals);
            describe('setting up the expected question fossilFuelsRadio results', function() {
                it('should succeed', function() {
                    locals.question = questions.fossilFuelsRadio;
                    locals.expectedResult = {
                        submission_score: null,
                        submission_correct: null,
                        instance_question_points: 0,
                        instance_question_score_perc: 0/17 * 100,
                    };
                });
            });
            helperQuestion.checkQuestionScore(locals);
            describe('setting up the expected assessment results', function() {
                it('should succeed', function() {
                    locals.expectedResult = {
                        assessment_instance_points: 14,
                        assessment_instance_score_perc: 14/assessmentMaxPoints * 100,
                    };
                });
            });
            helperQuestion.checkAssessmentScore(locals);
        });
    });

    partialCreditTests.forEach(function(partialCreditTest, iPartialCreditTest) {

        describe(`partial credit test #${iPartialCreditTest+1}`, function() {
            describe('server', function() {
                it('should shut down', function(callback) {
                    var that = this;
                    // pass "this" explicitly to enable this.timeout() calls
                    helperServer.after.call(that, function(err) {
                        if (ERR(err, callback)) return;
                        callback(null);
                    });
                });
                it('should start up', function(callback) {
                    var that = this;
                    // pass "this" explicitly to enable this.timeout() calls
                    helperServer.before.call(that, function(err) {
                        if (ERR(err, callback)) return;
                        callback(null);
                    });
                });
            });

            startExam();

            partialCreditTest.forEach(function(questionTest, iQuestionTest) {
                describe(`${questionTest.action} answer number #${iQuestionTest+1} for question ${questionTest.qid} with score ${questionTest.score}`, function() {
                    describe('setting up the submission data', function() {
                        it('should succeed', function() {
                            locals.shouldHaveButtons = ['grade', 'save'];
                            locals.postAction = questionTest.action;
                            locals.question = questions[questionTest.qid];
                            locals.question.points += questionTest.sub_points;
                            locals.totalPoints += questionTest.sub_points;
                            locals.expectedResult = {
                                submission_score: (questionTest.action == 'save') ? null : (questionTest.score / 100),
                                submission_correct: (questionTest.action == 'save') ? null : (questionTest.score == 100),
                                instance_question_points: locals.question.points,
                                instance_question_score_perc: locals.question.points/locals.question.maxPoints * 100,
                                assessment_instance_points: locals.totalPoints,
                                assessment_instance_score_perc: locals.totalPoints/assessmentMaxPoints * 100,
                            };
                            locals.getSubmittedAnswer = function(_variant) {
                                return {
                                    s: String(questionTest.score),
                                };
                            };
                        });
                    });
                    helperQuestion.getInstanceQuestion(locals);
                    if (questionTest.succeed) {
                        helperQuestion.postInstanceQuestion(locals);
                        helperQuestion.checkQuestionScore(locals);
                        helperQuestion.checkAssessmentScore(locals);
                    } else {
                        helperQuestion.postInstanceQuestionAndFail(locals);
                    }
                });
            });
        });
    });
});
